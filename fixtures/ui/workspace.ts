import { z } from "zod";
import type { WorkspacePort } from "../../src/client/data/port.js";
import {
  adoptedContent,
  diff,
  proposalAnalysis,
  reconcile,
  stamp,
  validateProposal,
} from "../../src/domain/planning.js";
import { api, PlanView } from "../../src/shared/contracts/api.js";
import {
  Acknowledgement,
  PlanSnapshot,
} from "../../src/shared/contracts/context.js";
import {
  Interpretation,
  PlanningJob,
  PlanningProposal,
} from "../../src/shared/contracts/llm.js";
import { migratePlanV1 } from "../../src/shared/contracts/migration.js";
import type { PlanData } from "../../src/shared/contracts/planning.js";
import {
  Plan,
  ReconciliationPreview,
} from "../../src/shared/contracts/planning.js";
import { fixtureAnalysis } from "./analysis.js";
import { initialPlans, originalSnapshot, updatedSnapshot } from "./catalog.js";
export const LEGACY_STORAGE_KEY = "zju-course-assistant:synthetic-ui:v1";
export const STORAGE_KEY = "zju-course-assistant:synthetic-ui:v2";
const Stored = z.strictObject({
  version: z.literal(2),
  published: z.boolean(),
  plans: z.array(Plan).max(50),
});
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const snapshots = [originalSnapshot, updatedSnapshot];
const now = () => new Date().toISOString();

export class FixtureWorkspace implements WorkspacePort {
  readonly initialSnapshotId = originalSnapshot.meta.id;
  readonly nextSnapshotId = updatedSnapshot.meta.id;
  private previews = new Map<string, z.infer<typeof ReconciliationPreview>>();
  private failNext = false;
  private jobs = new Map<string, z.infer<typeof PlanningJob>>();
  private generationKeys = new Map<string, { body: string; id: string }>();
  private adoptions = new Map<string, { body: string; plan: PlanData }>();
  constructor(
    private readonly storage: StoragePort,
    private readonly delay = 100,
  ) {}

  private read() {
    let raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) {
      const legacy = this.storage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        const old = z
          .strictObject({
            version: z.literal(1),
            published: z.boolean(),
            plans: z.array(z.unknown()).max(50),
          })
          .parse(JSON.parse(legacy));
        const migrated = Stored.parse({
          ...old,
          version: 2,
          plans: old.plans.map(migratePlanV1),
        });
        for (const plan of migrated.plans)
          PlanSnapshot.parse({
            plan,
            snapshot: this.snapshot(plan.snapshotId),
          });
        this.storage.setItem(`${LEGACY_STORAGE_KEY}:backup`, legacy);
        raw = JSON.stringify(migrated);
        this.storage.setItem(STORAGE_KEY, raw);
      }
    }
    if (!raw)
      return Stored.parse({
        version: 2,
        published: false,
        plans: initialPlans,
      });
    try {
      const result = Stored.parse(JSON.parse(raw));
      for (const plan of result.plans)
        PlanSnapshot.parse({ plan, snapshot: this.snapshot(plan.snapshotId) });
      return result;
    } catch {
      throw new Error(
        "浏览器中的演示数据无法读取；请使用「重置演示」恢复，原数据未被覆盖。",
      );
    }
  }
  private save(state: z.infer<typeof Stored>) {
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(Stored.parse(state)));
    } catch {
      throw new Error(
        "无法保存演示数据，请检查浏览器存储权限或空间。修改尚未保存。",
      );
    }
  }
  private snapshot(id: string) {
    const result = snapshots.find((snapshot) => snapshot.meta.id === id);
    if (!result) throw new Error("演示快照不存在。");
    return result;
  }
  private find(id: string, revision?: number) {
    const result = this.read().plans.find((plan) => plan.id === id);
    if (!result) throw new Error("计划已被删除，请重新选择。");
    if (revision !== undefined && result.revision !== revision)
      throw new Error("计划版本已变化，请重试；旧操作未覆盖新版本。");
    return result;
  }
  private view(plan: PlanData) {
    return PlanView.parse({
      plan,
      latestLiveSnapshotId: null,
      requiresReconciliation:
        this.read().published && plan.snapshotId !== updatedSnapshot.meta.id,
    });
  }
  private async pause() {
    if (this.delay)
      await new Promise((resolve) => setTimeout(resolve, this.delay));
  }
  async listPlans() {
    const shouldFail = this.failNext;
    this.failNext = false;
    await this.pause();
    if (shouldFail) {
      throw new Error("演示加载失败。点击重试恢复，不会丢失计划。");
    }
    return api.listPlans.response.parse({
      items: this.read().plans.map((plan) => ({
        id: plan.id,
        termId: plan.termId,
        snapshotId: plan.snapshotId,
        revision: plan.revision,
        updatedAt: plan.updatedAt,
        name: plan.content.name,
      })),
      nextCursor: null,
    });
  }
  async getPlan(id: string) {
    await this.pause();
    return this.view(this.find(id));
  }
  async getSnapshot(id: string) {
    await this.pause();
    const snapshot = structuredClone(this.snapshot(id));
    return { ...snapshot, loadedCourseIds: snapshot.courses.map((c) => c.id) };
  }
  async getAnalysis(plan: PlanData) {
    await this.pause();
    const current = this.find(plan.id, plan.revision);
    return fixtureAnalysis(
      current,
      this.snapshot(current.snapshotId),
      this.view(current).requiresReconciliation,
    );
  }
  async createPlan(raw: z.infer<typeof api.createPlan.body>) {
    await this.pause();
    const input = api.createPlan.body.parse(raw);
    const state = this.read();
    if (state.plans.length >= 50) throw new Error("演示最多保存 50 个计划。");
    const source =
      input.mode === "copy"
        ? this.find(input.source.planId, input.source.expectedRevision)
        : null;
    const base = initialPlans[0];
    if (!base) throw new Error("Missing fixture seed");
    const snapshotId =
      input.mode === "empty" ? input.snapshotId : source?.snapshotId;
    if (!snapshotId) throw new Error("Missing fixture snapshot");
    this.snapshot(snapshotId);
    const plan = Plan.parse({
      ...structuredClone(source ?? base),
      id: `plan-${crypto.randomUUID()}`,
      revision: 1,
      snapshotId,
      createdAt: now(),
      updatedAt: now(),
      content: {
        ...structuredClone(source?.content ?? base.content),
        name: input.name,
        shortlist: structuredClone(source?.content.shortlist ?? []),
      },
      history: structuredClone(source?.history ?? []),
      unresolvedCourseIds: structuredClone(source?.unresolvedCourseIds ?? []),
    });
    state.plans.push(plan);
    this.save(state);
    return this.view(plan);
  }
  async updatePlan(id: string, raw: z.infer<typeof api.updatePlan.body>) {
    await this.pause();
    const input = api.updatePlan.body.parse(raw);
    const previous = this.find(id, input.expectedRevision);
    const plan = Plan.parse({
      ...previous,
      content: input.content,
      unresolvedCourseIds: previous.unresolvedCourseIds.filter((id) =>
        input.content.shortlist.some((c) => c.courseId === id),
      ),
      revision: previous.revision + 1,
      updatedAt: now(),
    });
    PlanSnapshot.parse({ plan, snapshot: this.snapshot(plan.snapshotId) });
    const baseline = this.snapshot(plan.snapshotId).enrolledSectionIds;
    if (
      baseline.state === "known" &&
      plan.content.shortlist.some((course) =>
        course.items.some((item) => baseline.value.includes(item.sectionId)),
      )
    )
      throw new Error("已选基线不能加入候选或排序。");
    const state = this.read();
    state.plans = state.plans.map((row) => (row.id === id ? plan : row));
    this.save(state);
    return this.view(plan);
  }
  async deletePlan(id: string, revision: number) {
    await this.pause();
    this.find(id, revision);
    const state = this.read();
    state.plans = state.plans.filter((row) => row.id !== id);
    this.save(state);
  }
  async previewReconciliation(
    id: string,
    raw: z.infer<typeof api.previewReconciliation.body>,
  ) {
    await this.pause();
    const input = api.previewReconciliation.body.parse(raw);
    const plan = this.find(id, input.expectedRevision);
    if (
      !this.read().published ||
      plan.snapshotId === updatedSnapshot.meta.id ||
      input.targetSnapshotId !== updatedSnapshot.meta.id
    )
      throw new Error("没有可对账的新演示快照。");
    const context = {
      plan,
      snapshot: this.snapshot(plan.snapshotId),
      latestLiveSnapshotId: null,
    };
    const proposedPlan = reconcile(context, updatedSnapshot, now());
    const changes = diff({ ...context, target: updatedSnapshot });
    const preview = ReconciliationPreview.parse({
      id: `preview-${crypto.randomUUID()}`,
      planId: id,
      expectedRevision: plan.revision,
      fromSnapshotId: plan.snapshotId,
      targetSnapshotId: updatedSnapshot.meta.id,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      changes,
      proposedPlan,
    });
    this.previews.set(preview.id, preview);
    return structuredClone(preview);
  }
  async applyReconciliation(
    id: string,
    previewId: string,
    raw: z.infer<typeof api.applyReconciliation.body>,
  ) {
    await this.pause();
    const input = api.applyReconciliation.body.parse(raw);
    this.find(id, input.expectedRevision);
    const preview = this.previews.get(previewId);
    if (!preview || Date.parse(preview.expiresAt) <= Date.now())
      throw new Error("对账预览已过期，请重新打开。");
    if (
      preview.planId !== id ||
      preview.expectedRevision !== input.expectedRevision
    )
      throw new Error("计划版本已变化，请重新生成对账预览。");
    Acknowledgement.parse({
      expectedIds: preview.changes.map((change) => change.id),
      acknowledgedIds: input.acknowledgedChangeIds,
    });
    const state = this.read();
    state.plans = state.plans.map((plan) =>
      plan.id === id ? preview.proposedPlan : plan,
    );
    this.save(state);
    this.previews.delete(previewId);
    return this.view(preview.proposedPlan);
  }
  async interpretPreferences(
    raw: z.infer<typeof api.interpretPreferences.body>,
  ) {
    await this.pause();
    const input = api.interpretPreferences.body.parse(raw);
    const plan = this.find(input.plan.planId, input.plan.expectedRevision);
    return Interpretation.parse({
      stamp: stamp({
        plan,
        snapshot: this.snapshot(plan.snapshotId),
        latestLiveSnapshotId: null,
      }),
      synthetic: true,
      output: {
        suggestedHardConstraints: [
          { id: "demo-no-overlap", kind: "no_teaching_overlap" },
        ],
        suggestedCriteria: ["free_mornings", "candidate_order"],
        unresolvedClauses: [],
        explanation:
          "固定的合成解析示例，并未理解输入文本。请编辑并逐项确认，或只将原文保留为软偏好。",
      },
    });
  }
  async generateTimetable(
    raw: z.infer<typeof api.generateTimetable.body>,
    key: string,
  ) {
    const input = api.generateTimetable.body.parse(raw);
    const body = JSON.stringify(input);
    const existing = this.generationKeys.get(key);
    if (existing) {
      if (existing.body !== body) throw new Error("幂等键对应不同请求。");
      return this.getPlanningJob(existing.id);
    }
    const plan = this.find(input.plan.planId, input.plan.expectedRevision);
    if (this.view(plan).requiresReconciliation)
      throw new Error("请先完成对账。");
    if (
      plan.content.preferences.unresolvedClauses.length ||
      (plan.content.preferences.note.trim() &&
        !plan.content.preferences.textConfirmed)
    )
      throw new Error("请先确认自然语言偏好。");
    const context = {
      plan,
      snapshot: this.snapshot(plan.snapshotId),
      latestLiveSnapshotId: null,
    };
    const job = PlanningJob.parse({
      id: `job-${crypto.randomUUID()}`,
      stamp: stamp(context),
      status: "running",
      createdAt: now(),
      finishedAt: null,
      proposals: [],
      error: null,
    });
    this.jobs.set(job.id, job);
    this.generationKeys.set(key, { body, id: job.id });
    // Authored demonstration, not a fallback planner or an actual model call.
    setTimeout(
      () => {
        if (job.status !== "running") return;
        const current = this.read().plans.find((p) => p.id === plan.id);
        if (
          !current ||
          current.revision !== plan.revision ||
          this.view(current).requiresReconciliation
        ) {
          job.status = "stale";
          job.finishedAt = now();
          return;
        }
        const authored: Record<string, string> = {
          math: "math-c",
          code: "code-a",
          design: "design-a",
          writing: "writing-a",
        };
        const selections = plan.content.shortlist.map((c) => ({
          courseId: c.courseId,
          sectionId: authored[c.courseId] ?? "missing-demo-section",
          reason: "固定演示选择，供预览和校验交互使用。",
        }));
        if (!selections.length) {
          job.status = "failed";
          job.finishedAt = now();
          job.error = {
            code: "VALIDATION_FAILED",
            message: "候选清单为空。",
            retryable: false,
            fields: [],
          };
          return;
        }
        const proposal = PlanningProposal.parse({
          id: `proposal-${crypto.randomUUID()}`,
          jobId: job.id,
          stamp: job.stamp,
          synthetic: true,
          createdAt: now(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          output: {
            selections,
            explanation:
              "合成示例课表；真实模型尚未接入，不代表对偏好的智能理解。",
          },
          baselineSectionIds:
            context.snapshot.enrolledSectionIds.state === "known"
              ? context.snapshot.enrolledSectionIds.value
              : [],
          validation: validateProposal(context, selections),
          analysis: proposalAnalysis(context, {
            selections,
            explanation: "合成示例",
          }),
        });
        job.status = "succeeded";
        job.proposals = [proposal];
        job.finishedAt = now();
      },
      Math.max(500, this.delay * 8),
    );
    return structuredClone(job);
  }
  async getPlanningJob(id: string) {
    await this.pause();
    const job = this.jobs.get(id);
    if (!job) throw new Error("排课任务不存在或演示页面已刷新，请重试。");
    const current = this.read().plans.find((p) => p.id === job.stamp.planId);
    if (
      !["cancelled", "failed", "stale"].includes(job.status) &&
      (!current ||
        current.revision !== job.stamp.planRevision ||
        this.view(current).requiresReconciliation)
    ) {
      job.status = "stale";
      job.proposals = [];
      job.finishedAt = now();
    }
    return PlanningJob.parse(structuredClone(job));
  }
  async cancelPlanningJob(id: string) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("任务不存在。");
    job.status = "cancelled";
    job.proposals = [];
    job.error = null;
    job.finishedAt = now();
    return structuredClone(job);
  }
  async adoptPlanningProposal(
    id: string,
    raw: z.infer<typeof api.adoptPlanningProposal.body>,
    key: string,
  ) {
    await this.pause();
    const input = api.adoptPlanningProposal.body.parse(raw);
    const body = JSON.stringify({ id, input });
    const existing = this.adoptions.get(key);
    if (existing) {
      if (existing.body !== body) throw new Error("幂等键对应不同采用请求。");
      return this.view(existing.plan);
    }
    const plan = this.find(input.plan.planId, input.plan.expectedRevision);
    if (this.view(plan).requiresReconciliation)
      throw new Error("请先完成对账。");
    const job = [...this.jobs.values()].find((j) =>
      j.proposals.some((p) => p.id === id),
    );
    const proposal = job?.proposals.find((p) => p.id === id);
    if (
      !proposal ||
      job?.status !== "succeeded" ||
      Date.parse(proposal.expiresAt) <= Date.now()
    )
      throw new Error("方案已取消或过期，请重新生成。");
    if (
      proposal.stamp.planId !== plan.id ||
      proposal.stamp.planRevision !== plan.revision
    )
      throw new Error("计划版本已变化。");
    const report = validateProposal(
      {
        plan,
        snapshot: this.snapshot(plan.snapshotId),
        latestLiveSnapshotId: null,
      },
      proposal.output.selections,
    );
    if (report.status !== "valid")
      throw new Error("方案未通过校验，不能采用。");
    const copy = Plan.parse({
      ...structuredClone(plan),
      id: `plan-${crypto.randomUUID()}`,
      revision: 1,
      createdAt: now(),
      updatedAt: now(),
      content: adoptedContent(plan, proposal.output, input.name),
    });
    const state = this.read();
    if (state.plans.length >= 50) throw new Error("演示最多保存 50 个计划。");
    state.plans.push(copy);
    this.save(state);
    this.adoptions.set(key, { body, plan: copy });
    return this.view(copy);
  }
  async publish() {
    await this.pause();
    const state = this.read();
    state.published = true;
    this.save(state);
  }
  failNextLoad() {
    this.failNext = true;
  }
  reset() {
    this.storage.removeItem(STORAGE_KEY);
    this.previews.clear();
    this.jobs.clear();
    this.generationKeys.clear();
    this.adoptions.clear();
    this.failNext = false;
  }
}
