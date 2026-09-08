import type { z } from "zod";
import { api, type OperationId } from "../../shared/contracts/api.js";
import { Failure, success } from "../../shared/contracts/common.js";
import type { PlanData } from "../../shared/contracts/planning.js";
import type { SnapshotView, WorkspacePort } from "./port.js";

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class HttpWorkspace implements WorkspacePort {
  private token = "";
  private pendingKeys = new Map<string, string>();
  termId = "";
  modelEndpointId = "";
  modelConfigured = false;
  async request<K extends OperationId>(
    operation: K,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
    body: unknown = null,
    key?: string,
  ): Promise<z.infer<(typeof api)[K]["response"]>> {
    const route = api[operation];
    let path = route.path as string;
    for (const [name, value] of Object.entries(params))
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    const search = new URLSearchParams(query);
    if (search.size) path += `?${search}`;
    const headers: Record<string, string> = {};
    if (this.token) headers["X-Local-Token"] = this.token;
    const fingerprint = JSON.stringify({ operation, params, query, body });
    if (route.idempotencyKey) {
      const requestKey =
        key ?? this.pendingKeys.get(fingerprint) ?? crypto.randomUUID();
      headers["Idempotency-Key"] = requestKey;
      if (!key) this.pendingKeys.set(fingerprint, requestKey);
    }
    if (route.body) headers["Content-Type"] = "application/json";
    const requestBody = route.body
      ? JSON.stringify(route.body.parse(body))
      : undefined;
    const signal = AbortSignal.timeout(
      [
        "summarizeComments",
        "interpretPreferences",
        "explainProjection",
      ].includes(operation)
        ? 150000
        : 45000,
    );
    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(path, {
        method: route.method,
        headers,
        ...(requestBody ? { body: requestBody } : {}),
        signal,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new HttpError(
        "LOCAL_CONNECTION_FAILED",
        "连接本机服务中断或超时，请确认程序仍在运行后重试。已提交的操作可能仍在执行，请先查看当前状态。",
      );
    }
    try {
      payload = await response.json();
    } catch {
      throw new HttpError(
        "INVALID_RESPONSE",
        "本机服务响应不完整或格式无效，请查看当前状态后重试。",
      );
    }
    if (!response.ok) {
      const parsed = Failure.safeParse(payload);
      throw new HttpError(
        parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
        parsed.success
          ? parsed.data.error.message
          : "本机服务返回了无效错误，请刷新重试。",
      );
    }
    const parsedData = success(route.response).parse(payload).data;
    if (route.idempotencyKey && !key) this.pendingKeys.delete(fingerprint);
    return parsedData as z.infer<(typeof api)[K]["response"]>;
  }
  async initialize(termId?: string) {
    const bootstrap = await this.request("bootstrap");
    this.token = bootstrap.localRequestToken;
    this.modelEndpointId = bootstrap.settings.content.endpoints[0]?.id ?? "";
    this.modelConfigured =
      !!this.modelEndpointId &&
      bootstrap.settings.content.llmEnabled &&
      (
        await this.request("getCredentialStatus", {
          endpointId: this.modelEndpointId,
        })
      ).configured;
    let cursor: string | undefined;
    const terms: z.infer<typeof api.listTerms.response>["items"] = [];
    do {
      const page = await this.request(
        "listTerms",
        {},
        cursor ? { cursor } : {},
      );
      terms.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    this.termId = termId ?? terms[0]?.id ?? "";
    const snapshots = this.termId
      ? await this.request("listSnapshots", {}, { termId: this.termId })
      : null;
    const snapshotId =
      snapshots?.latestLiveSnapshotId ?? snapshots?.items[0]?.id ?? null;
    return {
      terms,
      termId: this.termId,
      termLabel:
        terms.find((t) => t.id === this.termId)?.label ?? "尚无学期数据",
      initialSnapshotId: snapshotId,
      nextSnapshotId: snapshots?.latestLiveSnapshotId ?? null,
      synthetic:
        snapshots?.items.find((s) => s.id === snapshotId)?.provenance
          .synthetic ?? false,
      storageLabel: "本机 SQLite",
      dataDirectory: bootstrap.dataDirectory,
    };
  }
  async listPlans() {
    if (!this.termId) return { items: [], nextCursor: null };
    const items: z.infer<typeof api.listPlans.response>["items"] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request(
        "listPlans",
        {},
        { termId: this.termId, ...(cursor ? { cursor } : {}) },
      );
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return { items, nextCursor: null };
  }
  getPlan(id: string) {
    return this.request("getPlan", { planId: id });
  }
  async getSnapshot(
    id: string,
    courseIds: string[] = [],
  ): Promise<SnapshotView> {
    const overview = await this.request("getSnapshot", { snapshotId: id });
    const courses: z.infer<typeof api.listCourses.response>["items"] = [];
    let cursor: string | undefined;
    do {
      const page = await this.request(
        "listCourses",
        {},
        { snapshotId: id, limit: "100", ...(cursor ? { cursor } : {}) },
      );
      courses.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    const sections: z.infer<typeof api.listSections.response>["items"] = [];
    const required = new Set(courseIds);
    if (overview.enrolledSectionIds.state === "known")
      for (const sectionId of overview.enrolledSectionIds.value) {
        const section = await this.request(
          "getSection",
          { sectionId },
          { snapshotId: id },
        );
        sections.push(section);
      }
    for (const course of courses.filter((c) => required.has(c.id))) {
      cursor = undefined;
      do {
        const page: z.infer<typeof api.listSections.response> =
          await this.request(
            "listSections",
            { courseId: course.id },
            { snapshotId: id, ...(cursor ? { cursor } : {}) },
          );
        sections.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    }
    return {
      ...overview,
      courses,
      sections: [...new Map(sections.map((s) => [s.id, s])).values()],
      loadedCourseIds: [...required],
    };
  }
  getAnalysis(plan: PlanData) {
    return this.request(
      "analyzePlan",
      { planId: plan.id },
      { expectedRevision: String(plan.revision) },
    );
  }
  createPlan(input: z.infer<typeof api.createPlan.body>) {
    return this.request("createPlan", {}, {}, input);
  }
  updatePlan(id: string, input: z.infer<typeof api.updatePlan.body>) {
    return this.request("updatePlan", { planId: id }, {}, input);
  }
  async deletePlan(id: string, revision: number) {
    await this.request(
      "deletePlan",
      { planId: id },
      {},
      { expectedRevision: revision },
    );
  }
  previewReconciliation(
    id: string,
    input: z.infer<typeof api.previewReconciliation.body>,
  ) {
    return this.request("previewReconciliation", { planId: id }, {}, input);
  }
  applyReconciliation(
    id: string,
    previewId: string,
    input: z.infer<typeof api.applyReconciliation.body>,
  ) {
    return this.request(
      "applyReconciliation",
      { planId: id, previewId },
      {},
      input,
    );
  }
  interpretPreferences(input: z.infer<typeof api.interpretPreferences.body>) {
    return this.request("interpretPreferences", {}, {}, input);
  }
  generateTimetable(
    input: z.infer<typeof api.generateTimetable.body>,
    key: string,
  ) {
    return this.request("generateTimetable", {}, {}, input, key);
  }
  getPlanningJob(id: string) {
    return this.request("getPlanningJob", { jobId: id });
  }
  cancelPlanningJob(id: string) {
    return this.request("cancelPlanningJob", { jobId: id }, {}, {});
  }
  adoptPlanningProposal(
    id: string,
    input: z.infer<typeof api.adoptPlanningProposal.body>,
    key: string,
  ) {
    return this.request(
      "adoptPlanningProposal",
      { proposalId: id },
      {},
      input,
      key,
    );
  }
  previewImport(archive: unknown) {
    return this.request("previewImport", {}, {}, { archive });
  }
  applyImport(previewId: string, expectedDataRevision: number, key: string) {
    return this.request(
      "applyImport",
      { previewId },
      {},
      { expectedDataRevision, confirm: true },
      key,
    );
  }
  exportArchive() {
    return this.request("exportLocalData", {}, {}, { scope: "all" });
  }
}
