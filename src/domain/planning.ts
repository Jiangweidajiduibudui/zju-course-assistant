import type { z } from "zod";
import type {
  SnapshotData,
  TeachingSlot,
} from "../shared/contracts/catalog.js";
import { sameStamp } from "../shared/contracts/common.js";
import { PlanSnapshot } from "../shared/contracts/context.js";
import type { TimetableOutput } from "../shared/contracts/llm.js";
import {
  Draft,
  Plan,
  type PlanData,
  Projection,
  type ReconciliationChange,
  type ValidationData,
  ValidationReport,
} from "../shared/contracts/planning.js";
import type { FinalValidationInput, PlanningContext } from "./contracts.js";
import { VOLUNTEER_RULES, volunteerGroups } from "./volunteers.js";

type Slot = z.infer<typeof TeachingSlot>;
type Issue = ValidationData["issues"][number];
type Selection = { courseId: string; sectionId: string };
export const stamp = ({ plan, snapshot }: PlanningContext) => ({
  planId: plan.id,
  planRevision: plan.revision,
  snapshotId: snapshot.meta.id,
  rulesetId: VOLUNTEER_RULES.id,
});
export function teachingOverlaps(a: Slot, b: Slot) {
  return (
    a.partId === b.partId &&
    a.weekday === b.weekday &&
    a.startPeriod <= b.endPeriod &&
    b.startPeriod <= a.endPeriod &&
    a.weeks.some((w) => b.weeks.includes(w))
  );
}
// Cross-part overlap needs observed dates or a shared semester-week mapping.
export function calendarOverlap(
  snapshot: SnapshotData,
  a: Slot,
  b: Slot,
): boolean | null {
  if (a.partId === b.partId) return teachingOverlaps(a, b);
  if (
    a.startPeriod > b.endPeriod ||
    b.startPeriod > a.endPeriod ||
    a.weekday !== b.weekday
  )
    return false;
  const left = snapshot.term.parts.find(
    (p) => p.id === a.partId,
  )?.weekOneMonday;
  const right = snapshot.term.parts.find(
    (p) => p.id === b.partId,
  )?.weekOneMonday;
  if (left?.state !== "known" || right?.state !== "known") {
    const leftMap = snapshot.term.parts.find(
      (p) => p.id === a.partId,
    )?.semesterWeeks;
    const rightMap = snapshot.term.parts.find(
      (p) => p.id === b.partId,
    )?.semesterWeeks;
    if (leftMap?.state !== "known" || rightMap?.state !== "known") return null;
    const l = a.weeks.map(
      (w) => leftMap.value.find((x) => x.partWeek === w)?.semesterWeek,
    );
    const r = b.weeks.map(
      (w) => rightMap.value.find((x) => x.partWeek === w)?.semesterWeek,
    );
    if (l.includes(undefined) || r.includes(undefined)) return null;
    return l.some((w) => r.includes(w));
  }
  const days = (anchor: string, slot: Slot) =>
    slot.weeks.map(
      (w) => Date.parse(anchor) / 86400000 + 7 * (w - 1) + slot.weekday - 1,
    );
  const dates = new Set(days(left.value, a));
  return days(right.value, b).some((date) => dates.has(date));
}
export const primarySelections = (plan: PlanData): Selection[] =>
  plan.content.shortlist.flatMap((course) => {
    const item = course.items.find((i) => i.disposition === "candidate");
    return item
      ? [{ courseId: course.courseId, sectionId: item.sectionId }]
      : [];
  });
const baselineIds = (snapshot: SnapshotData) =>
  snapshot.enrolledSectionIds.state === "known"
    ? snapshot.enrolledSectionIds.value
    : [];
export function creditSummary(
  context: PlanningContext,
  ids: readonly string[],
) {
  const selected = new Set(
    context.snapshot.sections
      .filter((s) => ids.includes(s.id))
      .map((s) => s.courseId),
  );
  const courses = context.snapshot.courses.filter((c) => selected.has(c.id));
  const limits = [
    context.plan.content.preferences.creditLimit,
    ...context.plan.content.preferences.hardConstraints.flatMap((c) =>
      c.kind === "credit_limit" ? [c.maximum] : [],
    ),
  ].filter((n): n is number => n !== null);
  return {
    knownTotal: courses.reduce(
      (sum, c) => sum + (c.credits.state === "known" ? c.credits.value : 0),
      0,
    ),
    missingCourseIds: courses
      .filter((c) => c.credits.state !== "known")
      .map((c) => c.id),
    limit: limits.length ? Math.min(...limits) : null,
    includesBaseline: true as const,
  };
}
function collect(
  context: PlanningContext,
  selections: Selection[],
  scope: "proposal" | "draft" | "checklist",
) {
  const { plan, snapshot, latestLiveSnapshotId } = context;
  const issues: Issue[] = [];
  const add = (
    code: Issue["code"],
    severity: Issue["severity"],
    message: string,
    sectionIds: string[] = [],
    courseIds: string[] = [],
    slot: Slot | null = null,
    timeGroupId: string | null = null,
  ) => {
    issues.push({
      id: `issue-${code}-${issues.length}`,
      code,
      severity,
      message,
      sectionIds: [...new Set(sectionIds)],
      courseIds: [...new Set(courseIds)],
      slot,
      timeGroupId,
    });
  };
  if (latestLiveSnapshotId && latestLiveSnapshotId !== snapshot.meta.id)
    add("SNAPSHOT_STALE", "unknown", "快照已更新，请先对账。");
  if (snapshot.enrolledSectionIds.state !== "known")
    add(
      "BASELINE_UNKNOWN",
      "unknown",
      "已选基线未知，不能确认课表或学分完整性。",
    );
  if (
    plan.content.preferences.unresolvedClauses.length ||
    (plan.content.preferences.note.trim() &&
      !plan.content.preferences.textConfirmed)
  )
    add(
      "PREFERENCES_UNCONFIRMED",
      "unknown",
      "自然语言偏好尚未确认或仍有未决条款。",
    );
  const sections = new Map(snapshot.sections.map((s) => [s.id, s]));
  const baseline = baselineIds(snapshot);
  const baselineCourses = new Set(
    baseline.map((id) => sections.get(id)?.courseId),
  );
  const targets = plan.content.shortlist;
  if (!targets.length) add("NO_CANDIDATE", "unknown", "候选清单为空。");
  for (const course of targets) {
    const chosen = selections.filter((s) => s.courseId === course.courseId);
    if (plan.unresolvedCourseIds.includes(course.courseId))
      add(
        "COURSE_MISSING",
        "error",
        "课程已不存在，请处理对账历史。",
        [],
        [course.courseId],
      );
    if (!chosen.length)
      add(
        "NO_CANDIDATE",
        "unknown",
        "这门课没有选定候选教学班。",
        [],
        [course.courseId],
      );
    if (scope === "proposal" && chosen.length !== 1)
      add(
        "PROPOSAL_COVERAGE",
        "error",
        "方案必须为每门目标课程选择一个教学班。",
        chosen.map((s) => s.sectionId),
        [course.courseId],
      );
    if (scope !== "proposal" && chosen.length > VOLUNTEER_RULES.courseLimit)
      add(
        "COURSE_VOLUNTEER_LIMIT",
        "error",
        "同课程候选超过 3 个；请自行调整，未截断候选。",
        chosen.map((s) => s.sectionId),
        [course.courseId],
      );
  }
  const seen = new Set<string>();
  for (const selection of selections) {
    const { sectionId, courseId } = selection;
    const section = sections.get(sectionId);
    const course = targets.find((c) => c.courseId === courseId);
    if (
      seen.has(sectionId) ||
      !course?.items.some(
        (i) => i.sectionId === sectionId && i.disposition === "candidate",
      ) ||
      section?.courseId !== courseId
    )
      add(
        "CANDIDATE_MEMBERSHIP",
        "error",
        "方案含重复、跨课程或非候选教学班。",
        [sectionId],
        [courseId],
      );
    seen.add(sectionId);
    if (!section) {
      add(
        "SECTION_MISSING",
        "error",
        "教学班不存在于当前快照。",
        [sectionId],
        [courseId],
      );
      continue;
    }
    if (baseline.includes(sectionId) || baselineCourses.has(courseId))
      add(
        "BASELINE_LOCKED",
        "error",
        "已选课程是锁定基线，不能重复加入规划。",
        [sectionId],
        [courseId],
      );
    if (!section.listedInCatalog || section.officialState === "unavailable")
      add(
        "SECTION_UNAVAILABLE",
        "error",
        "官方状态为不可选或教学班已取消；可保留比较，但不能填报。",
        [sectionId],
        [courseId],
      );
    if (section.officialState === "unknown")
      add(
        "OFFICIAL_STATE_UNKNOWN",
        "unknown",
        "官方可选状态未知。",
        [sectionId],
        [courseId],
      );
    if (scope === "checklist" && section.selectionCode.state !== "known")
      add(
        "SELECTION_CODE_UNKNOWN",
        "unknown",
        "缺少可填写的选课代码。",
        [sectionId],
        [courseId],
      );
  }
  const allIds = [
    ...new Set([...baseline, ...selections.map((s) => s.sectionId)]),
  ];
  const all = allIds.flatMap((id) => {
    const s = sections.get(id);
    return s ? [s] : [];
  });
  for (const section of all) {
    if (section.meetings.state !== "known")
      add(
        "TEACHING_TIME_UNKNOWN",
        "unknown",
        "上课时间未知。",
        [section.id],
        [section.courseId],
      );
    if (section.exams.state !== "known")
      add(
        "EXAM_UNKNOWN",
        "warning",
        "考试时间未提供或尚未解析；该教学班的考试冲突暂无法核对，请留意后续安排。",
        [section.id],
        [section.courseId],
      );
    const rules = [
      ...plan.content.preferences.hardConstraints,
      ...(plan.content.preferences.courseOverrides.find(
        (o) => o.courseId === section.courseId,
      )?.hardConstraints ?? []),
    ];
    const blocked = [
      ...rules.flatMap((r) => (r.kind === "blocked_time" ? [r.slot] : [])),
      ...plan.content.preferences.timePreferences
        .filter((p) => p.strength === "blocked")
        .map((p) => p.slot),
    ];
    for (const slot of blocked)
      if (
        section.meetings.state === "known" &&
        section.meetings.value.some(
          (m) => calendarOverlap(snapshot, m.slot, slot) === true,
        )
      )
        add(
          "BLOCKED_TIME",
          "error",
          "教学安排占用已确认的不可用时段。",
          [section.id],
          [section.courseId],
          slot,
        );
    if (
      section.meetings.state === "known" &&
      blocked.some(
        (slot) =>
          section.meetings.state === "known" &&
          section.meetings.value.some(
            (m) => calendarOverlap(snapshot, m.slot, slot) === null,
          ),
      )
    )
      add(
        "TEACHING_TIME_UNKNOWN",
        "unknown",
        "缺少跨学期段日历，无法确认不可用时段是否重叠。",
        [section.id],
        [section.courseId],
      );
    for (const rule of rules) {
      if (rule.kind === "campus") {
        if (section.campus.state !== "known")
          add(
            "CAMPUS_UNKNOWN",
            "unknown",
            "硬性校区要求需要已知校区。",
            [section.id],
            [section.courseId],
          );
        else if (!rule.campuses.includes(section.campus.value))
          add(
            "CAMPUS_MISMATCH",
            "error",
            "教学班不符合已确认的校区要求。",
            [section.id],
            [section.courseId],
          );
      }
    }
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (!a || !b || a.courseId === b.courseId) continue;
      if (
        a.exams.state === "known" &&
        b.exams.state === "known" &&
        a.exams.value.some(
          (x) =>
            b.exams.state === "known" &&
            b.exams.value.some(
              (y) =>
                Date.parse(x.startsAt) < Date.parse(y.endsAt) &&
                Date.parse(y.startsAt) < Date.parse(x.endsAt),
            ),
        )
      )
        add(
          "EXAM_CONFLICT",
          "error",
          "不同课程考试时间重叠。",
          [a.id, b.id],
          [a.courseId, b.courseId],
        );
      if (a.meetings.state === "known" && b.meetings.state === "known")
        for (const m of a.meetings.value) {
          if (
            b.meetings.value.some(
              (n) => calendarOverlap(snapshot, m.slot, n.slot) === null,
            )
          )
            add(
              "TEACHING_TIME_UNKNOWN",
              "unknown",
              "缺少跨学期段日历，不能确认这些教学时段是否重叠。",
              [a.id, b.id],
              [a.courseId, b.courseId],
              m.slot,
            );
          if (
            b.meetings.value.some(
              (n) => calendarOverlap(snapshot, m.slot, n.slot) === true,
            )
          ) {
            const hard = [
              ...plan.content.preferences.hardConstraints,
              ...plan.content.preferences.courseOverrides
                .filter((o) => [a.courseId, b.courseId].includes(o.courseId))
                .flatMap((o) => o.hardConstraints),
            ].some((r) => r.kind === "no_teaching_overlap");
            add(
              "TEACHING_OVERLAP",
              hard ? "error" : "warning",
              hard
                ? "教学重叠违反已确认的硬约束。"
                : "教学时间重叠，仅提示后果；可自行取舍。",
              [a.id, b.id],
              [a.courseId, b.courseId],
              m.slot,
            );
            break;
          }
        }
    }
  const credits = creditSummary(context, allIds);
  if (credits.missingCourseIds.length)
    add(
      "CREDITS_UNKNOWN",
      "unknown",
      "部分课程学分未知；已知总数不是完整总学分。",
      [],
      credits.missingCourseIds,
    );
  if (credits.limit === null)
    add("CREDIT_LIMIT_MISSING", "unknown", "请填写并确认学分上限。");
  else if (credits.knownTotal > credits.limit)
    add(
      "CREDIT_LIMIT_EXCEEDED",
      "error",
      `已知学分 ${credits.knownTotal} 超过上限 ${credits.limit}，包含锁定基线。`,
    );
  if (scope !== "proposal") {
    const computed = volunteerGroups(
      snapshot,
      selections.map((s) => s.sectionId),
    );
    if (computed.unknown.size)
      add(
        "TIME_GROUP_UNKNOWN",
        "unknown",
        "部分上课时间或跨学期周次信息不足，暂无法完整核对重叠节次的志愿数量。",
        [...computed.unknown],
      );
    for (const group of computed.groups)
      if (group.sectionIds.length > VOLUNTEER_RULES.timeLimit)
        add(
          "TIME_GROUP_VOLUNTEER_LIMIT",
          "error",
          "同一教学周的重叠节次超过 3 个志愿。",
          group.sectionIds,
          [],
          null,
          group.id,
        );
  }
  if (scope === "checklist") {
    if (snapshot.meta.provenance.synthetic)
      add("FIXTURE_ONLY", "unknown", "合成数据不能生成可执行填写清单。");
    else if (snapshot.meta.provenance.origin !== "live")
      add(
        "IMPORTED_SNAPSHOT",
        "unknown",
        "导入快照不能直接用于填写清单，请读取并对账。",
      );
    if (!latestLiveSnapshotId)
      add("SNAPSHOT_STALE", "unknown", "缺少当前学期的最新真实快照。");
  }
  return ValidationReport.parse({
    status: issues.some((i) => i.severity === "error")
      ? "invalid"
      : issues.some((i) => i.severity === "unknown")
        ? "indeterminate"
        : "valid",
    issues,
  });
}
export function validateProposal(
  context: PlanningContext,
  selections: Selection[],
) {
  return collect(context, selections, "proposal");
}
export function validateDraft(context: PlanningContext) {
  return collect(
    context,
    context.plan.content.shortlist.flatMap((c) =>
      c.items
        .filter((i) => i.disposition === "candidate")
        .map((i) => ({ courseId: c.courseId, sectionId: i.sectionId })),
    ),
    "draft",
  );
}
export function validateChecklist(context: PlanningContext) {
  return collect(
    context,
    context.plan.content.shortlist.flatMap((c) =>
      c.items
        .filter((i) => i.disposition === "candidate")
        .map((i) => ({ courseId: c.courseId, sectionId: i.sectionId })),
    ),
    "checklist",
  );
}
export function finalValidate(input: FinalValidationInput) {
  const validation = validateProposal(
    input,
    input.arrangement.sectionIds.map((id) => ({
      sectionId: id,
      courseId:
        input.snapshot.sections.find((s) => s.id === id)?.courseId ?? "missing",
    })),
  );
  const expected = baselineIds(input.snapshot);
  if (
    !sameStamp(input.arrangement.stamp, stamp(input)) ||
    expected.length !== input.arrangement.baselineSectionIds.length ||
    expected.some((id) => !input.arrangement.baselineSectionIds.includes(id))
  ) {
    validation.issues.push({
      id: "issue-baseline-stamp",
      code: "BASELINE_LOCKED",
      severity: "error",
      message: "方案快照、修订或锁定基线不匹配。",
      courseIds: [],
      sectionIds: [],
      timeGroupId: null,
      slot: null,
    });
    validation.status = "invalid";
  }
  return validation;
}
export function project(context: PlanningContext) {
  const primary = primarySelections(context.plan).map((s) => s.sectionId);
  const baseline = baselineIds(context.snapshot);
  const alternatives = context.plan.content.shortlist.map((c) => ({
    courseId: c.courseId,
    sectionIds: c.items
      .filter((i) => i.disposition === "candidate")
      .slice(1)
      .map((i) => i.sectionId),
  }));
  const entries: z.infer<typeof Projection>["entries"] = [];
  for (const s of context.snapshot.sections) {
    const role = baseline.includes(s.id)
      ? "baseline"
      : primary.includes(s.id)
        ? "primary"
        : alternatives.some((c) => c.sectionIds.includes(s.id))
          ? "alternative"
          : null;
    if (role && s.meetings.state === "known")
      for (const m of s.meetings.value)
        entries.push({ sectionId: s.id, courseId: s.courseId, role, ...m });
  }
  return Projection.parse({
    stamp: stamp(context),
    primarySectionIds: primary,
    baselineSectionIds: baseline,
    alternatives,
    entries,
    credits: creditSummary(context, [...primary, ...baseline]),
    validation: validateProposal(context, primarySelections(context.plan)),
  });
}
export function toDraft(context: PlanningContext) {
  const computed = volunteerGroups(
    context.snapshot,
    context.plan.content.shortlist.flatMap((c) =>
      c.items
        .filter((i) => i.disposition === "candidate")
        .map((i) => i.sectionId),
    ),
  );
  return Draft.parse({
    stamp: stamp(context),
    entries: context.plan.content.shortlist.flatMap((c) =>
      c.items
        .filter((i) => i.disposition === "candidate")
        .map((i, index) => ({
          courseId: c.courseId,
          sectionId: i.sectionId,
          priority: index + 1,
          timeGroupIds: computed.unknown.has(i.sectionId)
            ? { state: "unknown", reason: "not_provided" }
            : {
                state: "known",
                value: computed.bySection.get(i.sectionId) ?? [],
              },
        })),
    ),
    validation: validateDraft(context),
  });
}
export function adoptedContent(
  plan: PlanData,
  output: z.infer<typeof TimetableOutput>,
  name: string,
) {
  const content = structuredClone(plan.content);
  content.name = name;
  for (const selection of output.selections) {
    const course = content.shortlist.find(
      (c) => c.courseId === selection.courseId,
    );
    const item = course?.items.find(
      (i) =>
        i.sectionId === selection.sectionId && i.disposition === "candidate",
    );
    if (!course || !item)
      throw new Error("Proposal is not a current candidate");
    course.items = [
      item,
      ...course.items.filter((i) => i.sectionId !== item.sectionId),
    ];
  }
  return content;
}
export function diff(
  context: PlanningContext & { target: SnapshotData },
): z.infer<typeof ReconciliationChange>[] {
  const { snapshot, target, plan } = context;
  if (target.meta.termId !== plan.termId)
    throw new Error("Cross-term reconciliation");
  const result: z.infer<typeof ReconciliationChange>[] = [];
  const add = (
    kind: z.infer<typeof ReconciliationChange>["kind"],
    courseId: string | null,
    sectionId: string | null,
    fields: string[],
    before: string[],
    after: string[],
  ) =>
    result.push({
      id: `change-${result.length}`,
      kind,
      courseId,
      sectionId,
      fields,
      before,
      after,
      suggestedSectionIds: courseId
        ? target.sections
            .filter(
              (s) =>
                s.courseId === courseId &&
                s.listedInCatalog &&
                s.id !== sectionId,
            )
            .map((s) => s.id)
        : [],
    });
  const rows = [...plan.content.shortlist];
  for (const sectionId of baselineIds(snapshot)) {
    const section = snapshot.sections.find((s) => s.id === sectionId);
    if (
      section &&
      !rows.some((c) => c.items.some((i) => i.sectionId === sectionId))
    )
      rows.push({
        courseId: section.courseId,
        favorite: false,
        note: "",
        items: [
          { sectionId, disposition: "reference", favorite: false, note: "" },
        ],
      });
  }
  for (const row of rows) {
    const old = snapshot.courses.find((c) => c.id === row.courseId);
    const next = target.courses.find((c) => c.id === row.courseId);
    if (!next)
      add(
        "course_missing",
        row.courseId,
        null,
        ["course"],
        [old?.title ?? row.courseId],
        ["课程已不存在，保留待处理标记和历史"],
      );
    else if (old && JSON.stringify(old) !== JSON.stringify(next))
      add(
        "course_changed",
        row.courseId,
        null,
        ["course"],
        [JSON.stringify(old)],
        [JSON.stringify(next)],
      );
    for (const item of row.items) {
      const a = snapshot.sections.find((s) => s.id === item.sectionId);
      const b = target.sections.find((s) => s.id === item.sectionId);
      if (!b?.listedInCatalog)
        add(
          "section_cancelled",
          row.courseId,
          item.sectionId,
          ["listedInCatalog"],
          ["教学班在目录中"],
          ["教学班取消；笔记保留历史"],
        );
      else if (a) {
        const changed = (Object.keys(a) as Array<keyof typeof a>).filter(
          (k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]),
        );
        if (changed.length)
          add(
            changed.every((k) =>
              [
                "quotas",
                "pending",
                "officialState",
                "officialStateLabel",
              ].includes(k),
            )
              ? "status_changed"
              : "section_changed",
            row.courseId,
            item.sectionId,
            changed,
            changed.map((k) => JSON.stringify(a[k])),
            changed.map((k) => JSON.stringify(b[k])),
          );
      }
    }
  }
  if (
    JSON.stringify(snapshot.enrolledSectionIds) !==
    JSON.stringify(target.enrolledSectionIds)
  )
    add(
      "baseline_changed",
      null,
      null,
      ["enrolledSectionIds"],
      [JSON.stringify(snapshot.enrolledSectionIds)],
      [JSON.stringify(target.enrolledSectionIds)],
    );
  if (JSON.stringify(snapshot.rules) !== JSON.stringify(target.rules))
    add(
      "rules_changed",
      null,
      null,
      ["rules"],
      [JSON.stringify(snapshot.rules)],
      [JSON.stringify(target.rules)],
    );
  return result;
}
export function reconcile(
  context: PlanningContext,
  target: SnapshotData,
  at: string,
) {
  if (
    context.plan.termId !== target.meta.termId ||
    context.snapshot.meta.id === target.meta.id
  )
    throw new Error("Invalid snapshot transition");
  const plan = structuredClone(context.plan);
  plan.snapshotId = target.meta.id;
  plan.revision++;
  plan.updatedAt = at;
  plan.unresolvedCourseIds = [];
  const enrolledCourses = new Set(
    target.sections
      .filter((s) => baselineIds(target).includes(s.id))
      .map((s) => s.courseId),
  );
  plan.content.shortlist = plan.content.shortlist.filter((course) => {
    const present = target.courses.some((c) => c.id === course.courseId);
    if (!present) plan.unresolvedCourseIds.push(course.courseId);
    const enrolled = enrolledCourses.has(course.courseId);
    if (enrolled && course.items.length === 0)
      plan.history.push({
        courseId: course.courseId,
        courseLabel:
          context.snapshot.courses.find((c) => c.id === course.courseId)
            ?.title ?? course.courseId,
        sectionLabel: null,
        previousItem: null,
        courseNote: course.note,
        previousSnapshotId: context.snapshot.meta.id,
        reason: "enrolled",
        at,
      });
    course.items = course.items.filter((item) => {
      if (
        present &&
        !enrolled &&
        target.sections.some(
          (s) => s.id === item.sectionId && s.listedInCatalog,
        )
      )
        return true;
      plan.history.push({
        courseId: course.courseId,
        courseLabel:
          context.snapshot.courses.find((c) => c.id === course.courseId)
            ?.title ?? course.courseId,
        sectionLabel:
          context.snapshot.sections.find((s) => s.id === item.sectionId)
            ?.selectionCode.state === "known"
            ? item.sectionId
            : null,
        previousItem: item,
        courseNote: course.note,
        previousSnapshotId: context.snapshot.meta.id,
        reason: !present
          ? "course_missing"
          : enrolled
            ? "enrolled"
            : "section_cancelled",
        at,
      });
      return false;
    });
    return !enrolled;
  });
  plan.content.preferences.courseOverrides =
    plan.content.preferences.courseOverrides.filter((o) =>
      plan.content.shortlist.some((c) => c.courseId === o.courseId),
    );
  PlanSnapshot.parse({ plan, snapshot: target });
  return Plan.parse(plan);
}

export function proposalAnalysis(
  context: PlanningContext,
  output: z.infer<typeof TimetableOutput>,
) {
  try {
    const plan = {
      ...context.plan,
      content: adoptedContent(context.plan, output, context.plan.content.name),
    };
    const proposed = { ...context, plan };
    return { projection: project(proposed), draft: toDraft(proposed) };
  } catch {
    return null;
  }
}
