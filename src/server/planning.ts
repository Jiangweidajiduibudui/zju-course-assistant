import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { PlanningContext } from "../domain/contracts.js";
import {
  adoptedContent,
  proposalAnalysis,
  stamp,
  validateProposal,
} from "../domain/planning.js";
import { api } from "../shared/contracts/api.js";
import { sameStamp } from "../shared/contracts/common.js";
import {
  GENERATION_LIMITS,
  GenerateTimetableInput,
  Interpretation,
  InterpretationOutput,
  PlanningJob,
  PlanningProposal,
  TimetableExchange,
} from "../shared/contracts/llm.js";
import type { PreferenceProfile } from "../shared/contracts/planning.js";
import { Plan } from "../shared/contracts/planning.js";
import { fail, ServiceError } from "./errors.js";
import { EndpointBinding, type ModelService } from "./llm/service.js";
import type { Store } from "./storage/store.js";

// The guarded provider and synthetic tests share this narrow orchestration seam.
export interface PlanningDriver {
  generate(
    input: z.infer<typeof GenerateTimetableInput>,
    signal: AbortSignal,
    feedback?: unknown,
  ): Promise<unknown>;
  interpret?(
    text: string,
    signal: AbortSignal,
    profile?: z.infer<typeof PreferenceProfile>,
  ): Promise<unknown>;
  synthetic: boolean;
}
export class PlanningService {
  private closed = false;
  private active = new Map<string, AbortController>();
  constructor(
    private store: Store,
    private driver?: PlanningDriver,
    private models?: ModelService,
  ) {}
  context(id: string, revision?: number): PlanningContext {
    const plan = this.store.plan(id, revision);
    return {
      plan,
      snapshot: this.store.snapshot(plan.snapshotId),
      latestLiveSnapshotId: this.store.latest(plan.termId),
    };
  }
  private current(context: PlanningContext) {
    if (
      context.latestLiveSnapshotId &&
      context.latestLiveSnapshotId !== context.snapshot.meta.id
    )
      fail("RECONCILIATION_REQUIRED", "有新快照，请先对账。");
  }
  async interpret(raw: z.infer<typeof api.interpretPreferences.body>) {
    const input = api.interpretPreferences.body.parse(raw);
    const context = this.context(
      input.plan.planId,
      input.plan.expectedRevision,
    );
    this.current(context);
    const binding = this.driver ? null : this.models?.binding(input.endpointId);
    const driver =
      this.driver ?? (binding ? this.models?.driver(binding) : undefined);
    if (!driver?.interpret)
      return fail(
        "LLM_NOT_IMPLEMENTED",
        "真实偏好解析将在 P5 接入；现在可手动设置并确认偏好。",
      );
    const signal = AbortSignal.timeout(GENERATION_LIMITS.deadlineMs);
    const output = InterpretationOutput.parse(
      await driver.interpret(
        context.plan.content.preferences.note,
        signal,
        context.plan.content.preferences,
      ),
    );
    this.current(this.context(context.plan.id, context.plan.revision));
    return Interpretation.parse({
      stamp: stamp(context),
      synthetic: driver.synthetic || context.snapshot.meta.provenance.synthetic,
      output,
    });
  }
  start(raw: z.infer<typeof api.generateTimetable.body>) {
    const input = api.generateTimetable.body.parse(raw);
    const context = this.context(
      input.plan.planId,
      input.plan.expectedRevision,
    );
    this.current(context);
    const binding = this.driver ? null : this.models?.binding(input.endpointId);
    const driver =
      this.driver ?? (binding ? this.models?.driver(binding) : undefined);
    if (!driver)
      return fail(
        "LLM_NOT_IMPLEMENTED",
        "真实 AI 排课将在 P5 接入；当前可使用手动规划或 fixture 演示。",
      );
    if (
      this.store
        .resources("job", PlanningJob)
        .some((j) => ["queued", "running"].includes(j.status))
    )
      fail("OPERATION_IN_PROGRESS", "已有排课任务，请先取消或等待完成。");
    const preferences = context.plan.content.preferences;
    if (
      preferences.unresolvedClauses.length ||
      (preferences.note.trim() && !preferences.textConfirmed)
    )
      fail("VALIDATION_FAILED", "请先确认自然语言偏好并解决未决条款。");
    const ids = context.plan.content.shortlist.flatMap((c) =>
      c.items
        .filter((i) => i.disposition === "candidate")
        .map((i) => i.sectionId),
    );
    const baseline =
      context.snapshot.enrolledSectionIds.state === "known"
        ? context.snapshot.enrolledSectionIds.value
        : [];
    if (context.snapshot.enrolledSectionIds.state !== "known")
      fail("VALIDATION_FAILED", "锁定基线未知，不能生成完整课表。");
    const parsedPayload = GenerateTimetableInput.safeParse({
      term: context.snapshot.term,
      profile: preferences,
      targets: context.plan.content.shortlist.map((c) => ({
        course: context.snapshot.courses.find((x) => x.id === c.courseId),
        orderedSectionIds: c.items
          .filter((i) => i.disposition === "candidate")
          .map((i) => i.sectionId),
      })),
      sections: context.snapshot.sections.filter(
        (s) => ids.includes(s.id) || baseline.includes(s.id),
      ),
      baselineSectionIds: baseline,
      reviewEvidence: [],
    });
    if (!parsedPayload.success)
      return fail(
        "VALIDATION_FAILED",
        "每门目标课程都需要有效候选，且上下文必须完整。",
      );
    const payload = parsedPayload.data;
    if (JSON.stringify(payload).length > GENERATION_LIMITS.maxInputCharacters)
      fail(
        "PAYLOAD_TOO_LARGE",
        "候选上下文超过排课输入预算，请明确缩小候选范围。",
      );
    const job = PlanningJob.parse({
      id: `job-${randomUUID()}`,
      stamp: stamp(context),
      status: "queued",
      createdAt: new Date().toISOString(),
      finishedAt: null,
      proposals: [],
      error: null,
    });
    this.store.put("job", job.id, job);
    if (binding) this.store.put("job-endpoint", job.id, binding);
    queueMicrotask(() => void this.run(job.id, context, payload, driver));
    return job;
  }
  private async run(
    id: string,
    context: PlanningContext,
    payload: z.infer<typeof GenerateTimetableInput>,
    driver: PlanningDriver,
  ) {
    const controller = new AbortController();
    this.active.set(id, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const job = this.get(id);
      if (job.status !== "queued") return;
      this.store.put("job", id, { ...job, status: "running" });
      const generate = async () => {
        let raw: unknown;
        let feedback: unknown;
        for (
          let attempt = 0;
          attempt < GENERATION_LIMITS.maxRequests;
          attempt++
        ) {
          raw = await driver.generate(payload, controller.signal, feedback);
          if (controller.signal.aborted) throw new Error("Cancelled");
          const exchange = TimetableExchange.safeParse({
            input: payload,
            output: raw,
          });
          if (!exchange.success)
            feedback = {
              codes: ["OUTPUT_SCHEMA_OR_CANDIDATE_REFERENCE_INVALID"],
            };
          else {
            const report = validateProposal(
              context,
              exchange.data.output.selections,
            );
            if (report.status === "valid") return raw;
            feedback = {
              issues: report.issues.map((i) => ({
                code: i.code,
                sectionIds: i.sectionIds,
                courseIds: i.courseIds,
              })),
            };
          }
        }
        return raw;
      };
      const raw = await Promise.race([
        generate(),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("Cancelled")),
            { once: true },
          ),
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Deadline exceeded"));
          }, GENERATION_LIMITS.deadlineMs);
        }),
      ]);
      if (this.closed) return;
      const current = this.get(id);
      if (current.status !== "running") return;
      const parsed = TimetableExchange.safeParse({
        input: payload,
        output: raw,
      });
      if (!parsed.success)
        return fail("LLM_OUTPUT_INVALID", "模型输出不符合当前候选契约。");
      const output = parsed.data.output;
      const proposal = PlanningProposal.parse({
        id: `proposal-${randomUUID()}`,
        jobId: id,
        stamp: stamp(context),
        synthetic:
          driver.synthetic || context.snapshot.meta.provenance.synthetic,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600000).toISOString(),
        output,
        baselineSectionIds: payload.baselineSectionIds,
        validation: validateProposal(context, output.selections),
        analysis: proposalAnalysis(context, output),
      });
      this.store.put("job", id, {
        ...current,
        status: "succeeded",
        finishedAt: new Date().toISOString(),
        proposals: [proposal],
      });
    } catch (error) {
      if (this.closed) return;
      const job = this.store.get("job", id, PlanningJob);
      if (job && ["queued", "running"].includes(job.status))
        this.store.put("job", id, {
          ...job,
          status: "failed",
          finishedAt: new Date().toISOString(),
          proposals: [],
          error: {
            code:
              error instanceof ServiceError ? error.code : "LLM_OUTPUT_INVALID",
            message: `${error instanceof ServiceError ? error.message : "生成失败、超时或输出无效。"} 原计划未改变；这不证明不存在可行课表。`,
            retryable: true,
            fields: [],
          },
        });
    } finally {
      if (timer) clearTimeout(timer);
      this.active.delete(id);
    }
  }
  get(id: string) {
    const job = this.store.get("job", id, PlanningJob);
    if (!job) return fail("NOT_FOUND", "排课任务不存在。");
    const plan = this.store.plans().find((p) => p.id === job.stamp.planId);
    const latest = plan ? this.store.latest(plan.termId) : null;
    const binding = this.store.get("job-endpoint", id, EndpointBinding);
    if (
      !["failed", "cancelled", "stale"].includes(job.status) &&
      ((binding && !this.models?.current(binding)) ||
        !plan ||
        plan.revision !== job.stamp.planRevision ||
        plan.snapshotId !== job.stamp.snapshotId ||
        (latest && latest !== plan.snapshotId))
    ) {
      job.status = "stale";
      job.finishedAt = new Date().toISOString();
      job.proposals = [];
      this.store.put("job", id, job);
      this.active.get(id)?.abort();
    }
    return job;
  }
  cancel(id: string) {
    const job = this.get(id);
    this.active.get(id)?.abort();
    const cancelled = PlanningJob.parse({
      ...job,
      status: "cancelled",
      proposals: [],
      error: null,
      finishedAt: new Date().toISOString(),
    });
    this.store.put("job", id, cancelled);
    return cancelled;
  }
  adopt(id: string, raw: z.infer<typeof api.adoptPlanningProposal.body>) {
    const input = api.adoptPlanningProposal.body.parse(raw);
    const context = this.context(
      input.plan.planId,
      input.plan.expectedRevision,
    );
    this.current(context);
    const owner = this.store
      .resources("job", PlanningJob)
      .find((j) => j.proposals.some((p) => p.id === id));
    if (!owner) return fail("PREVIEW_EXPIRED", "方案不存在、已取消或已过期。");
    const job = this.get(owner.id);
    const proposal = job.proposals.find((p) => p.id === id);
    if (
      job.status !== "succeeded" ||
      !proposal ||
      Date.parse(proposal.expiresAt) <= Date.now()
    )
      return fail("PREVIEW_EXPIRED", "方案不存在、已取消或已过期。");
    if (!sameStamp(proposal.stamp, stamp(context)))
      fail("REVISION_CONFLICT", "方案与当前计划修订不匹配。");
    const baseline =
      context.snapshot.enrolledSectionIds.state === "known"
        ? context.snapshot.enrolledSectionIds.value
        : [];
    if (
      baseline.length !== proposal.baselineSectionIds.length ||
      baseline.some((id) => !proposal.baselineSectionIds.includes(id))
    )
      fail("VALIDATION_FAILED", "锁定基线不匹配。");
    if (
      validateProposal(context, proposal.output.selections).status !== "valid"
    )
      fail("VALIDATION_FAILED", "方案未通过当前规则校验，不能采用。");
    const now = new Date().toISOString();
    const plan = Plan.parse({
      ...context.plan,
      id: `plan-${randomUUID()}`,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      content: adoptedContent(context.plan, proposal.output, input.name),
    });
    this.store.insertPlan(plan);
    return plan;
  }
  cancelAll() {
    for (const id of this.active.keys()) this.cancel(id);
  }
  close() {
    if (this.closed) return;
    this.cancelAll();
    this.closed = true;
  }
}
