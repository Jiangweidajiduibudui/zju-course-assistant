import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { z } from "zod";
import {
  diff,
  project,
  reconcile,
  stamp,
  toDraft,
  validateChecklist,
} from "../domain/planning.js";
import { api, type OperationId, PlanView } from "../shared/contracts/api.js";
import type { SectionData } from "../shared/contracts/catalog.js";
import { Acknowledgement, PlanSnapshot } from "../shared/contracts/context.js";
import {
  ExplainProjectionOutput,
  Explanation,
  GENERATION_LIMITS,
  SummaryExchange,
  SummaryRecord,
} from "../shared/contracts/llm.js";
import {
  emptyPreferences,
  migrateArchive,
} from "../shared/contracts/migration.js";
import {
  ClearPreview,
  ImportPreview,
  LocalArchive,
} from "../shared/contracts/operations.js";
import type { PlanData } from "../shared/contracts/planning.js";
import {
  FillingChecklist,
  Plan,
  ReconciliationPreview,
} from "../shared/contracts/planning.js";
import { Comment } from "../shared/contracts/reviews.js";
import { fail } from "./errors.js";
import { ModelService, type Transport } from "./llm/service.js";
import { type PlanningDriver, PlanningService } from "./planning.js";
import { prepareSummary } from "./reviews/comments.js";
import { ReviewService } from "./reviews/service.js";
import type { ReviewDriver } from "./reviews/source.js";
import type { Store } from "./storage/store.js";
import { SchoolJobs } from "./zdbk/jobs.js";
import type { SchoolDriver } from "./zdbk/read.js";

const at = () => new Date().toISOString();
const id = (kind: string) => `${kind}-${randomUUID()}`;
const expiry = () => new Date(Date.now() + 600000).toISOString();

export { defaultSettings } from "./llm/service.js";

const ImportResource = z.strictObject({
  preview: ImportPreview,
  archive: LocalArchive,
});
function paginate<T>(
  items: T[],
  query: Record<string, string>,
  binding: string,
  secret: string,
) {
  let offset = 0;
  if (query.cursor) {
    try {
      const [payload, signature] = query.cursor.split(".");
      if (
        !payload ||
        !signature ||
        createHmac("sha256", secret).update(payload).digest("hex") !== signature
      )
        throw new Error("Cursor signature");
      const decoded = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      );
      if (
        decoded.binding !== binding ||
        !Number.isSafeInteger(decoded.offset) ||
        decoded.offset < 0 ||
        decoded.offset > items.length
      )
        throw new Error("Cursor context");
      offset = decoded.offset;
    } catch {
      return fail("INVALID_REQUEST", "分页游标与当前查询或数据修订不匹配。");
    }
  }
  const limit = Number(query.limit ?? 50);
  let nextCursor: string | null = null;
  if (offset + limit < items.length) {
    const payload = Buffer.from(
      JSON.stringify({ offset: offset + limit, binding }),
    ).toString("base64url");
    nextCursor = `${payload}.${createHmac("sha256", secret).update(payload).digest("hex")}`;
  }
  return { items: items.slice(offset, offset + limit), nextCursor };
}
export class Service {
  readonly planning: PlanningService;
  readonly models: ModelService;
  readonly school: SchoolJobs | null;
  readonly reviews: ReviewService;
  private readonly cursorSecret = randomBytes(32).toString("hex");
  constructor(
    readonly store: Store,
    readonly token: string,
    driver?: PlanningDriver,
    transport?: Transport,
    schoolDriver?: SchoolDriver,
    reviewDriver?: ReviewDriver,
  ) {
    this.school = schoolDriver ? new SchoolJobs(store, schoolDriver) : null;
    this.models = new ModelService(store, transport);
    this.reviews = new ReviewService(
      store,
      () => this.models.settings(),
      reviewDriver,
    );
    this.planning = new PlanningService(
      store,
      driver,
      this.models,
      this.reviews,
    );
  }
  private requireSchool() {
    return (
      this.school ??
      fail("FEATURE_NOT_IMPLEMENTED", "当前运行环境未启用学校适配器。")
    );
  }
  private async explain(raw: unknown) {
    const input = api.explainProjection.body.parse(raw);
    const context = this.planning.context(
      input.plan.planId,
      input.plan.expectedRevision,
    );
    if (
      context.latestLiveSnapshotId &&
      context.latestLiveSnapshotId !== context.snapshot.meta.id
    )
      return fail("RECONCILIATION_REQUIRED", "请先对账后再解释。");
    const binding = this.models.binding(input.endpointId);
    const projection = project(context);
    const output = ExplainProjectionOutput.parse(
      await this.models.call(
        "explainProjection",
        {
          subjectRef: context.plan.id,
          sanitizedQuestion: input.question,
          sanitizedProjectionSummary: JSON.stringify({
            status: projection.validation.status,
            courseCount: context.plan.content.shortlist.length,
          }).slice(0, 2000),
          sanitizedConflictDescriptions: projection.validation.issues
            .slice(0, 100)
            .map((i) =>
              JSON.stringify({
                code: i.code,
                sectionIds: i.sectionIds,
                courseIds: i.courseIds,
              }).slice(0, 2000),
            ),
        },
        binding,
        AbortSignal.timeout(GENERATION_LIMITS.deadlineMs),
      ),
    );
    const latest = this.planning.context(
      context.plan.id,
      context.plan.revision,
    );
    if (latest.latestLiveSnapshotId !== context.latestLiveSnapshotId)
      return fail("REVISION_CONFLICT", "解释期间快照已变化。");
    return Explanation.parse({ stamp: stamp(context), output });
  }
  private async summarize(raw: unknown) {
    const input = api.summarizeComments.body.parse(raw),
      binding = this.models.binding(input.endpointId);
    const review = this.reviews.get(input.reviewId);
    if (review.revision !== input.expectedReviewRevision)
      return fail("REVISION_CONFLICT", "评价已变化，请刷新。");
    const comments =
      this.store.get("comments", review.id, z.array(Comment).max(10000)) ?? [];
    const prepared = prepareSummary(review.id, comments);
    if (!prepared) return fail("VALIDATION_FAILED", "没有可用于摘要的评论。");
    const hash = createHash("sha256")
      .update(JSON.stringify(prepared))
      .digest("hex");
    const cached = this.store
      .resources("summary", SummaryRecord)
      .find(
        (s) =>
          s.reviewId === review.id &&
          s.reviewRevision === review.revision &&
          s.endpointId === binding.endpointId &&
          s.endpointRevision === binding.revision &&
          s.contentHash === hash,
      );
    if (cached) return cached;
    const rawOutput = await this.models.call(
      "summarizeComments",
      prepared,
      binding,
      AbortSignal.timeout(GENERATION_LIMITS.deadlineMs),
    );
    const parsed = SummaryExchange.safeParse({
      input: prepared,
      output: rawOutput,
    });
    if (!parsed.success)
      return fail("LLM_OUTPUT_INVALID", "摘要结构或样本信息无效。");
    return this.store.transaction(() => {
      if (
        this.reviews.get(review.id).revision !== review.revision ||
        !this.models.current(binding)
      )
        return fail("REVISION_CONFLICT", "评价或模型设置已变化，摘要已丢弃。");
      const summary = SummaryRecord.parse({
        id: id("summary"),
        reviewId: review.id,
        reviewRevision: review.revision,
        endpointId: binding.endpointId,
        endpointRevision: binding.revision,
        generatedAt: at(),
        contentHash: hash,
        output: parsed.data.output,
      });
      this.store.put("summary", summary.id, summary);
      return summary;
    });
  }
  view(plan: PlanData) {
    const latestLiveSnapshotId = this.store.latest(plan.termId);
    return PlanView.parse({
      plan,
      latestLiveSnapshotId,
      requiresReconciliation:
        !!latestLiveSnapshotId && latestLiveSnapshotId !== plan.snapshotId,
    });
  }
  // Every synchronous mutation is wrapped by app.ts in one immediate transaction,
  // including validation of the response and idempotency receipt persistence.
  execute(
    operation: OperationId,
    params: Record<string, string>,
    query: Record<string, string>,
    raw: unknown,
  ): unknown {
    const store = this.store;
    const binding = createHash("sha256")
      .update(
        JSON.stringify({
          operation,
          params,
          query: Object.fromEntries(
            Object.entries(query)
              .filter(([key]) => key !== "cursor")
              .sort(),
          ),
          revision: store.revision(),
        }),
      )
      .digest("hex");
    const page = <T>(items: T[], _query: Record<string, string>) =>
      paginate(items, query, binding, this.cursorSecret);

    const planId = params.planId ?? "";
    const snapshotId = query.snapshotId ?? params.snapshotId ?? "";
    switch (operation) {
      case "bootstrap":
        return {
          localRequestToken: this.token,
          session: this.school?.driver.status() ?? {
            state: "logged_out",
            checkedAt: at(),
          },
          settings: this.models.settings(),
          dataRevision: store.revision(),
          dataDirectory: dirname(store.file),
          capabilities: {
            adviseOnly: true,
            admissionRisk: "not_evaluable",
            llm: {
              summarizeComments: true,
              interpretPreferences: true,
              generateTimetable: true,
              explainProjection: true,
            },
          },
        };
      case "getSession":
        return (
          this.school?.driver.status() ?? {
            state: "logged_out",
            checkedAt: at(),
          }
        );
      case "startLogin":
        return this.requireSchool().start("login");
      case "startSync":
        return this.requireSchool().start(
          "sync",
          api.startSync.body.parse(raw).termId,
        );
      case "getJob":
        return this.requireSchool().get(params.jobId ?? "");
      case "cancelJob":
        return this.requireSchool().cancel(params.jobId ?? "");
      case "logout":
        return this.requireSchool().logout();
      case "getSettings":
        return this.models.settings();
      case "updateSettings":
        return this.models.update(raw);
      case "getCredentialStatus":
        return this.models.credential(params.endpointId ?? "");
      case "putCredential":
        return this.models.credential(
          params.endpointId ?? "",
          api.putCredential.body.parse(raw).apiKey,
        );
      case "deleteCredential":
        return this.models.credential(params.endpointId ?? "", null);
      case "listTerms":
        return page(
          [
            ...new Map(
              [
                ...(this.school?.driver.terms() ?? []),
                ...store.snapshotSummaries().map((s) => s.term),
              ].map((t) => [t.id, t]),
            ).values(),
          ],
          query,
        );
      case "listSnapshots":
        return {
          ...page(
            store.snapshotSummaries(query.termId).map((s) => s.meta),
            query,
          ),
          latestLiveSnapshotId: store.latest(query.termId ?? ""),
        };
      case "getSnapshot": {
        const {
          meta,
          term,
          enrolledSectionIds,
          officialVolunteers,
          academicContext,
          rules,
        } = store.snapshot(snapshotId);
        return {
          meta,
          term,
          enrolledSectionIds,
          officialVolunteers,
          academicContext,
          rules,
        };
      }
      case "listCourses": {
        const snapshot = store.snapshot(snapshotId);
        const matches = (v: string | undefined, text: string) =>
          !v || text.toLowerCase().includes(v.toLowerCase());
        const byCourse = new Map<string, SectionData[]>();
        for (const section of snapshot.sections) {
          const group = byCourse.get(section.courseId);
          if (group) group.push(section);
          else byCourse.set(section.courseId, [section]);
        }
        const courses = snapshot.courses.filter((course) => {
          const sections = byCourse.get(course.id) ?? [];
          if (
            !matches(query.courseCode, course.code) ||
            !matches(
              query.college,
              course.college.state === "known" ? course.college.value : "",
            ) ||
            (query.categoryCode &&
              !(
                course.category.state === "known" &&
                course.category.value.code === query.categoryCode
              ))
          )
            return false;
          if (
            query.q &&
            !matches(
              query.q,
              `${course.code} ${course.title} ${sections.map((s) => (s.selectionCode.state === "known" ? s.selectionCode.value : "")).join(" ")} ${sections.flatMap((s) => (s.teachers.state === "known" ? s.teachers.value.map((t) => t.name) : [])).join(" ")}`,
            )
          )
            return false;
          if (
            !query.teacher &&
            !query.partId &&
            !query.location &&
            !query.weekday &&
            !query.period &&
            query.availableOnly !== "true"
          )
            return true;
          return sections.some(
            (s) =>
              s.listedInCatalog &&
              (!query.teacher ||
                (s.teachers.state === "known" &&
                  s.teachers.value.some((t) =>
                    matches(query.teacher, t.name),
                  ))) &&
              (!query.partId || s.partIds.includes(query.partId)) &&
              (!query.availableOnly ||
                query.availableOnly === "false" ||
                s.officialState === "available") &&
              ((!query.location && !query.weekday && !query.period) ||
                (s.meetings.state === "known" &&
                  s.meetings.value.some(
                    (m) =>
                      (!query.partId || m.slot.partId === query.partId) &&
                      (!query.location ||
                        (m.location.state === "known" &&
                          matches(query.location, m.location.value))) &&
                      (!query.weekday ||
                        m.slot.weekday === Number(query.weekday)) &&
                      (!query.period ||
                        (m.slot.startPeriod <= Number(query.period) &&
                          m.slot.endPeriod >= Number(query.period))),
                  ))),
          );
        });
        return { ...page(courses, query), snapshotId };
      }
      case "listSections":
        return {
          ...page(
            store
              .snapshot(snapshotId)
              .sections.filter((s) => s.courseId === params.courseId),
            query,
          ),
          snapshotId,
        };
      case "getSection":
        return (
          store
            .snapshot(snapshotId)
            .sections.find((s) => s.id === params.sectionId) ??
          fail("NOT_FOUND", "教学班不存在。")
        );
      case "listPlans":
        return page(
          store.plans(query.termId).map((p) => ({
            id: p.id,
            termId: p.termId,
            snapshotId: p.snapshotId,
            revision: p.revision,
            updatedAt: p.updatedAt,
            name: p.content.name,
          })),
          query,
        );
      case "getPlan":
        return this.view(store.plan(planId));
      case "createPlan": {
        const input = api.createPlan.body.parse(raw);
        const source =
          input.mode === "copy"
            ? store.plan(input.source.planId, input.source.expectedRevision)
            : null;
        const snapshot = store.snapshot(
          input.mode === "empty"
            ? input.snapshotId
            : (source?.snapshotId ?? ""),
        );
        const plan = Plan.parse({
          schemaVersion: 2,
          id: id("plan"),
          termId: snapshot.meta.termId,
          snapshotId: snapshot.meta.id,
          revision: 1,
          createdAt: at(),
          updatedAt: at(),
          content: source
            ? { ...structuredClone(source.content), name: input.name }
            : {
                name: input.name,
                shortlist: [],
                preferences: emptyPreferences(),
              },
          unresolvedCourseIds: source?.unresolvedCourseIds ?? [],
          history: source?.history ?? [],
        });
        store.insertPlan(plan);
        return this.view(plan);
      }
      case "updatePlan": {
        const input = api.updatePlan.body.parse(raw);
        const previous = store.plan(planId, input.expectedRevision);
        const snapshot = store.snapshot(previous.snapshotId);
        const plan = Plan.parse({
          ...previous,
          revision: previous.revision + 1,
          updatedAt: at(),
          content: input.content,
          unresolvedCourseIds: previous.unresolvedCourseIds.filter((id) =>
            input.content.shortlist.some((c) => c.courseId === id),
          ),
        });
        PlanSnapshot.parse({ plan, snapshot });
        const baselineCourses = new Set(
          snapshot.enrolledSectionIds.state === "known"
            ? snapshot.sections
                .filter(
                  (s) =>
                    snapshot.enrolledSectionIds.state === "known" &&
                    snapshot.enrolledSectionIds.value.includes(s.id),
                )
                .map((s) => s.courseId)
            : [],
        );
        if (plan.content.shortlist.some((c) => baselineCourses.has(c.courseId)))
          fail("VALIDATION_FAILED", "已选课程是锁定基线，不能加入候选或排序。");
        store.updatePlan(plan, previous.revision);
        return this.view(plan);
      }
      case "deletePlan": {
        const input = api.deletePlan.body.parse(raw);
        store.deletePlan(planId, input.expectedRevision);
        return { acknowledged: true };
      }
      case "analyzePlan": {
        const context = this.planning.context(
          planId,
          Number(query.expectedRevision),
        );
        return { projection: project(context), draft: toDraft(context) };
      }
      case "previewReconciliation": {
        const input = api.previewReconciliation.body.parse(raw);
        const context = this.planning.context(planId, input.expectedRevision);
        if (store.latest(context.plan.termId) !== input.targetSnapshotId)
          fail("SNAPSHOT_MISMATCH", "对账目标必须是当前最新 live 快照。");
        const target = store.snapshot(input.targetSnapshotId);
        const preview = ReconciliationPreview.parse({
          id: id("preview"),
          planId,
          expectedRevision: input.expectedRevision,
          fromSnapshotId: context.snapshot.meta.id,
          targetSnapshotId: target.meta.id,
          expiresAt: expiry(),
          changes: diff({ ...context, target }),
          proposedPlan: reconcile(context, target, at()),
        });
        store.put("reconciliation", preview.id, preview);
        return preview;
      }
      case "applyReconciliation": {
        const input = api.applyReconciliation.body.parse(raw);
        const plan = store.plan(planId, input.expectedRevision);
        const preview = store.get(
          "reconciliation",
          params.previewId ?? "",
          ReconciliationPreview,
        );
        if (!preview || Date.parse(preview.expiresAt) <= Date.now())
          return fail("PREVIEW_EXPIRED", "对账预览已过期。");
        if (
          preview.planId !== planId ||
          preview.expectedRevision !== plan.revision
        )
          fail("REVISION_CONFLICT", "对账计划或修订不匹配。");
        if (store.latest(plan.termId) !== preview.targetSnapshotId)
          fail("SNAPSHOT_MISMATCH", "对账期间又有新快照，请重新预览。");
        if (
          !Acknowledgement.safeParse({
            expectedIds: preview.changes.map((c) => c.id),
            acknowledgedIds: input.acknowledgedChangeIds,
          }).success
        )
          fail("VALIDATION_FAILED", "需要逐项确认全部变化。");
        store.updatePlan(preview.proposedPlan, plan.revision);
        store.remove("reconciliation", preview.id);
        return this.view(preview.proposedPlan);
      }
      case "explainProjection":
        return this.explain(raw);
      case "summarizeComments":
        return this.summarize(raw);
      case "lookupReviewMatch":
        return this.reviews.lookup(raw);
      case "confirmReviewMatch":
        return this.reviews.confirm(params.matchId ?? "", raw);
      case "fetchReview":
        return this.reviews.fetch(raw);
      case "getReview":
        return this.reviews.get(params.reviewId ?? "");
      case "listComments": {
        const { review, items } = this.reviews.comments(
          params.reviewId ?? "",
          Number(query.expectedRevision),
        );
        return {
          ...page(items, query),
          reviewId: review.id,
          reviewRevision: review.revision,
        };
      }
      case "confirmCourseGrade":
        return this.reviews.confirmCourse(params.reviewId ?? "", raw);
      case "getSummary": {
        const review = this.reviews.get(params.reviewId ?? "");
        if (review.revision !== Number(query.expectedRevision))
          return fail("REVISION_CONFLICT", "评价已变化。");
        const endpoint = this.models.endpoint(query.endpointId ?? "");
        return (
          store
            .resources("summary", SummaryRecord)
            .find(
              (s) =>
                s.reviewId === review.id &&
                s.reviewRevision === review.revision &&
                s.endpointId === endpoint.id &&
                s.endpointRevision === endpoint.revision,
            ) ?? fail("NOT_FOUND", "尚未生成当前版本摘要。")
        );
      }
      case "interpretPreferences":
        return this.planning.interpret(
          api.interpretPreferences.body.parse(raw),
        );
      case "generateTimetable":
        return this.planning.start(api.generateTimetable.body.parse(raw));
      case "getPlanningJob":
        return this.planning.get(params.jobId ?? "");
      case "cancelPlanningJob":
        return this.planning.cancel(params.jobId ?? "");
      case "adoptPlanningProposal":
        return this.view(
          this.planning.adopt(
            params.proposalId ?? "",
            api.adoptPlanningProposal.body.parse(raw),
          ),
        );
      case "exportChecklist": {
        const input = api.exportChecklist.body.parse(raw);
        const context = this.planning.context(planId, input.expectedRevision);
        const full = validateChecklist(context);
        const excludedIds = [
          ...new Set(
            full.issues
              .filter((i) =>
                [
                  "SECTION_UNAVAILABLE",
                  "CREDITS_UNKNOWN",
                  "SELECTION_CODE_UNKNOWN",
                  "OFFICIAL_STATE_UNKNOWN",
                  "TEACHING_TIME_UNKNOWN",
                ].includes(i.code),
              )
              .flatMap((i) =>
                i.sectionIds.length
                  ? i.sectionIds
                  : context.plan.content.shortlist
                      .filter((c) => i.courseIds.includes(c.courseId))
                      .flatMap((c) =>
                        c.items
                          .filter((i) => i.disposition === "candidate")
                          .map((i) => i.sectionId),
                      ),
              ),
          ),
        ];
        if (
          !Acknowledgement.safeParse({
            expectedIds: excludedIds,
            acknowledgedIds: input.acknowledgedExcludedSectionIds,
          }).success
        )
          fail("VALIDATION_FAILED", "请明确确认被排除的教学班。");
        const plan = structuredClone(context.plan);
        plan.content.shortlist = plan.content.shortlist
          .map((c) => ({
            ...c,
            items: c.items.filter((i) => !excludedIds.includes(i.sectionId)),
          }))
          .filter((c) => c.items.some((i) => i.disposition === "candidate"));
        const retained = { ...context, plan };
        const report = validateChecklist(retained);
        if (report.status !== "valid")
          fail("VALIDATION_FAILED", "当前数据或志愿草稿未通过填写清单校验。");
        // Preserve original priorities; never silently renumber after exclusion.
        const entries = toDraft(context)
          .entries.filter((e) => !excludedIds.includes(e.sectionId))
          .map((e) => {
            const s = context.snapshot.sections.find(
              (s) => s.id === e.sectionId,
            );
            const c = context.snapshot.courses.find((c) => c.id === e.courseId);
            if (!s || !c || s.selectionCode.state !== "known")
              return fail("VALIDATION_FAILED", "选课代码缺失。");
            return {
              courseId: c.id,
              courseCode: c.code,
              courseTitle: c.title,
              sectionId: s.id,
              selectionCode: s.selectionCode.value,
              priority: e.priority,
            };
          });
        const checklist = FillingChecklist.parse({
          stamp: toDraft(context).stamp,
          generatedAt: at(),
          snapshotCapturedAt: context.snapshot.meta.capturedAt,
          adviseOnly: true,
          entries,
          excluded: excludedIds.map((sectionId) => ({
            sectionId,
            reasons: full.issues.filter(
              (i) =>
                i.sectionIds.includes(sectionId) ||
                i.courseIds.includes(
                  context.snapshot.sections.find((s) => s.id === sectionId)
                    ?.courseId ?? "",
                ),
            ),
          })),
          validation: report,
          admissionRisk: "not_evaluable",
        });
        return {
          checklist,
          text: [
            ...entries.map(
              (e) =>
                `${e.courseTitle} (${e.courseCode}) · ${e.selectionCode} · 第 ${e.priority} 志愿`,
            ),
            ...report.issues
              .filter((issue) => issue.severity === "warning")
              .map((issue) => {
                const codes = context.snapshot.courses
                  .filter((course) => issue.courseIds.includes(course.id))
                  .map((course) => course.code)
                  .join("、");
                return `提醒${codes ? `（${codes}）` : ""}：${issue.message}`;
              }),
          ].join("\n"),
        };
      }
      case "exportLocalData": {
        const input = api.exportLocalData.body.parse(raw);
        const plans =
          input.scope === "all"
            ? store.plans()
            : input.planIds.map((id) => store.plan(id));
        const ids = new Set(
          plans.flatMap((p) => [
            p.snapshotId,
            ...p.history.map((h) => h.previousSnapshotId),
          ]),
        );
        return LocalArchive.parse({
          format: "zju-course-assistant",
          schemaVersion: 2,
          exportedAt: at(),
          plans,
          snapshots:
            input.scope === "all"
              ? store.snapshots()
              : [...ids].map((id) => store.snapshot(id)),
        });
      }
      case "previewImport": {
        const input = api.previewImport.body.parse(raw);
        let archive: z.infer<typeof LocalArchive>;
        try {
          archive = migrateArchive(input.archive);
        } catch {
          return fail(
            "IMPORT_INVALID",
            "归档结构、版本或引用无效；未修改本地数据。",
          );
        }
        const preview = ImportPreview.parse({
          id: id("import"),
          expiresAt: expiry(),
          archiveHash: createHash("sha256")
            .update(JSON.stringify(archive))
            .digest("hex"),
          expectedDataRevision: store.revision(),
          strategy: "add_as_new",
          snapshotCount: archive.snapshots.length,
          planCount: archive.plans.length,
          warnings: [
            ...(input.archive.schemaVersion === 1
              ? ["将 v1 计划迁移为 v2，旧文本保留为未确认偏好。"]
              : []),
            "全部添加为新 ID；导入快照不成为 latest live。",
          ],
        });
        store.put("import", preview.id, { preview, archive });
        return preview;
      }
      case "applyImport": {
        const input = api.applyImport.body.parse(raw);
        const resource = store.get(
          "import",
          params.previewId ?? "",
          ImportResource,
        );
        if (!resource || Date.parse(resource.preview.expiresAt) <= Date.now())
          return fail("PREVIEW_EXPIRED", "导入预览已过期。");
        if (
          store.revision() !== input.expectedDataRevision ||
          resource.preview.expectedDataRevision !== input.expectedDataRevision
        )
          fail("REVISION_CONFLICT", "本地数据已变化，请重新预览。");
        const mapping = new Map(
          resource.archive.snapshots.map((s) => [s.meta.id, id("snapshot")]),
        );
        const snapshots = resource.archive.snapshots.map((s) => ({
          ...s,
          meta: {
            ...s.meta,
            id: mapping.get(s.meta.id) ?? "",
            provenance: { ...s.meta.provenance, origin: "imported" as const },
          },
        }));
        const plans = resource.archive.plans.map((p) => ({
          ...p,
          id: id("plan"),
          snapshotId: mapping.get(p.snapshotId) ?? "",
          revision: 1,
          createdAt: at(),
          updatedAt: at(),
          history: p.history.map((h) => ({
            ...h,
            previousSnapshotId: mapping.get(h.previousSnapshotId) ?? "",
          })),
        }));
        for (const s of snapshots) store.insertSnapshot(s);
        for (const p of plans) store.insertPlan(p);
        store.bump();
        store.remove("import", resource.preview.id);
        return {
          planIds: plans.map((p) => p.id),
          snapshotIds: snapshots.map((s) => s.meta.id),
          dataRevision: store.revision(),
        };
      }
      case "previewClear": {
        const input = api.previewClear.body.parse(raw);
        const preview = ClearPreview.parse({
          id: id("clear"),
          scope: input.scope,
          expiresAt: expiry(),
          expectedDataRevision: store.revision(),
          planCount: store.counts().plans,
          snapshotCount: store.counts().snapshots,
        });
        store.put("clear", preview.id, preview);
        return preview;
      }
      case "applyClear": {
        const input = api.applyClear.body.parse(raw);
        const preview = store.get(
          "clear",
          params.previewId ?? "",
          ClearPreview,
        );
        if (!preview || Date.parse(preview.expiresAt) <= Date.now())
          return fail("PREVIEW_EXPIRED", "清除预览已过期。");
        if (
          input.expectedDataRevision !== store.revision() ||
          preview.expectedDataRevision !== input.expectedDataRevision
        )
          fail("REVISION_CONFLICT", "本地数据已变化，请重新预览。");
        return (async () => {
          this.planning.cancelAll();
          this.reviews.clear();
          if (this.school) {
            if (preview.scope === "all") await this.school.logout();
            else await this.school.close();
          }
          const result = store.transaction(() => {
            if (input.expectedDataRevision !== store.revision())
              return fail(
                "REVISION_CONFLICT",
                "清除期间本地数据变化，请重新预览。",
              );
            store.db.exec(
              "DELETE FROM plans; DELETE FROM snapshots; DELETE FROM idempotency;",
            );
            store.db.exec(
              preview.scope === "all"
                ? "DELETE FROM resources;"
                : "DELETE FROM resources WHERE kind <> 'settings';",
            );
            store.clearSnapshotCache();
            store.bump();
            return { acknowledged: true, dataRevision: store.revision() };
          });
          // Remove the private account binding only after the DB clear commits.
          // A failed DB transaction must not leave old account data unbound.
          this.school?.driver.clearBinding();
          if (preview.scope === "all") this.models.clear();
          return result;
        })();
      }
      case "exportDiagnostics":
        return {
          schemaVersion: 1,
          generatedAt: at(),
          applicationVersion: "0.1.0",
          counts: {
            plans: store.counts().plans,
            snapshots: store.counts().snapshots,
          },
          events: [],
        };
      default:
        return fail(
          "FEATURE_NOT_IMPLEMENTED",
          "此功能尚未接入；本阶段没有学校或第三方请求。",
        );
    }
  }
}
