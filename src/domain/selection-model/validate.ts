import {
  type CandidatePlan,
  type ConflictReport,
  type CourseCode,
  candidatePlanSchema,
  type ErrorCode,
  ErrorCodes,
  type Section,
  type SectionId,
} from "../../shared/contracts/index.js";
import { timeslotKey } from "./timeslot.js";
import type { SolverInput, ValidationResult } from "./types.js";

/**
 * 确定性终校验（阶段⑥；D25、D30；docs/04 §4.3 校验链）——
 * 本函数是"LLM 输出触达状态"前的最后一道闸，也是性质测试的核心不变量：
 * **终校验永不接受非法方案**（Task 1 门禁）。
 *
 * 校验链（顺序固定）：
 * 1. Schema 合法（调用方已由 Zod 保证，此处防御性复查关键字段）；
 * 2. 教学班 ID 全部存在且属于待选池（MODEL_SECTION_NOT_IN_POOL）；
 * 3. 课程覆盖满足（待选池目标课程都有志愿）；
 * 4. 课程/时间段志愿组均 ≤3 且顺位唯一（MODEL_VOLUNTEER_LIMIT_*）；
 * 5. 锁定状态保持：已选固定、已填志愿锁定、手动锁定不变（MODEL_LOCK_VIOLATION）;
 * 6. 硬约束通过：考试冲突、学分上限、规则栏硬约束（MODEL_EXAM_CONFLICT 等）。
 *
 * 任何失败 → 不改动当前方案（D27 原子性）。
 *
 * Task 1 交付（Task 4 前必须可被 planner 调用）；
 * 测试锚点：tests/domain/validate.test.ts + properties.test.ts。
 */
export function finalValidate(input: SolverInput, plan: CandidatePlan): ValidationResult {
  const schemaResult = candidatePlanSchema.safeParse(plan);
  if (!schemaResult.success) {
    return {
      kind: "invalid",
      conflicts: [
        conflict(
          ErrorCodes.COMMON_VALIDATION_FAILED,
          [],
          [],
          "候选方案不符合 candidatePlan.v1 基础结构",
        ),
      ],
    };
  }

  if (input.rules.creditLimit === null) {
    return {
      kind: "invalid",
      conflicts: [
        conflict(
          ErrorCodes.MODEL_CREDIT_LIMIT_MISSING,
          [],
          [],
          "用户尚未填写必需的学分上限，不能生成方案",
        ),
      ],
    };
  }

  const conflicts: ConflictReport[] = [];
  const poolSectionIds = collectPoolSectionIdSet(input);
  const planSectionIds = new Set<SectionId>();
  const sectionsInPlan: Section[] = [];

  for (const volunteer of plan.volunteers) {
    planSectionIds.add(volunteer.sectionId);
    const section = input.sections.get(volunteer.sectionId);

    if (!section || !poolSectionIds.has(volunteer.sectionId)) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_SECTION_NOT_IN_POOL,
          [volunteer.sectionId],
          section ? [section.courseCode] : [volunteer.courseCode],
          "方案包含不在用户待选池内的教学班",
        ),
      );
      continue;
    }

    if (section.courseCode !== volunteer.courseCode) {
      conflicts.push(
        conflict(
          ErrorCodes.COMMON_VALIDATION_FAILED,
          [volunteer.sectionId],
          [section.courseCode],
          "方案中的课程代码与教学班目录不一致",
        ),
      );
    }

    sectionsInPlan.push(section);
  }

  conflicts.push(...validatePoolCoverage(input, planSectionIds));
  conflicts.push(...validateLocks(input, plan));
  conflicts.push(...validateGroupRanks(plan));
  conflicts.push(...validateTimeslotVolunteerLimit(sectionsInPlan));

  const sectionsForHardChecks = collectSectionsForHardChecks(input, sectionsInPlan);
  conflicts.push(...validateHardFields(sectionsForHardChecks));
  conflicts.push(...validateCreditLimit(sectionsForHardChecks, input.rules.creditLimit));
  conflicts.push(...validateExamConflicts(sectionsForHardChecks));

  return conflicts.length > 0 ? { kind: "invalid", conflicts } : { kind: "valid" };
}

function collectSectionsForHardChecks(
  input: SolverInput,
  sectionsInPlan: readonly Section[],
): Section[] {
  const sections = [...sectionsInPlan];
  const seenSectionIds = new Set(sectionsInPlan.map((section) => section.sectionId));

  for (const selectedSectionId of input.baseline.selected) {
    if (seenSectionIds.has(selectedSectionId)) {
      continue;
    }

    const selectedSection = input.sections.get(selectedSectionId);
    if (selectedSection) {
      sections.push(selectedSection);
      seenSectionIds.add(selectedSectionId);
    }
  }

  return sections;
}

function collectPoolSectionIdSet(input: SolverInput): Set<SectionId> {
  const sectionIds = new Set<SectionId>();

  for (const target of input.pool.targets) {
    for (const sectionId of target.candidateSectionIds) {
      sectionIds.add(sectionId);
    }
  }

  return sectionIds;
}

function validatePoolCoverage(
  input: SolverInput,
  planSectionIds: ReadonlySet<SectionId>,
): ConflictReport[] {
  const conflicts: ConflictReport[] = [];

  for (const target of input.pool.targets) {
    const hasAnyCandidate = target.candidateSectionIds.some((sectionId) =>
      planSectionIds.has(sectionId),
    );
    if (!hasAnyCandidate) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
          [],
          [target.courseCode],
          "方案没有覆盖待选池目标课程",
        ),
      );
    }
  }

  return conflicts;
}

function validateLocks(input: SolverInput, plan: CandidatePlan): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const volunteersBySectionId = new Map(
    plan.volunteers.map((volunteer) => [volunteer.sectionId, volunteer]),
  );

  for (const baselineVolunteer of input.baseline.volunteers) {
    const planVolunteer = volunteersBySectionId.get(baselineVolunteer.sectionId);
    if (!planVolunteer || planVolunteer.rank !== baselineVolunteer.rank) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_LOCK_VIOLATION,
          [baselineVolunteer.sectionId],
          courseCodesFor(input, [baselineVolunteer.sectionId]),
          "已填志愿的教学班与顺位必须保持不变",
        ),
      );
    }
  }

  for (const lockedSectionId of input.lockedSectionIds) {
    const planVolunteer = volunteersBySectionId.get(lockedSectionId);
    if (!planVolunteer) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_LOCK_VIOLATION,
          [lockedSectionId],
          courseCodesFor(input, [lockedSectionId]),
          "手动锁定的教学班必须保留在方案中",
        ),
      );
    }
  }

  return conflicts;
}

function validateGroupRanks(plan: CandidatePlan): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const groupById = new Map(plan.groups.map((group) => [group.groupId, group]));
  const volunteersByGroup = new Map<string, CandidatePlan["volunteers"]>();

  for (const volunteer of plan.volunteers) {
    const current = volunteersByGroup.get(volunteer.groupId) ?? [];
    current.push(volunteer);
    volunteersByGroup.set(volunteer.groupId, current);
  }

  for (const [groupId, volunteers] of volunteersByGroup) {
    const rankSet = new Set(volunteers.map((volunteer) => volunteer.rank));
    const group = groupById.get(groupId);
    const errorCode =
      group?.kind === "timeslot"
        ? ErrorCodes.MODEL_VOLUNTEER_LIMIT_TIMESLOT
        : ErrorCodes.MODEL_VOLUNTEER_LIMIT_COURSE;

    if (volunteers.length > 3 || rankSet.size !== volunteers.length) {
      conflicts.push(
        conflict(
          errorCode,
          volunteers.map((volunteer) => volunteer.sectionId),
          volunteers.map((volunteer) => volunteer.courseCode),
          "志愿组最多 3 个教学班，且组内顺位不能重复",
        ),
      );
    }
  }

  return conflicts;
}

function validateTimeslotVolunteerLimit(sectionsInPlan: readonly Section[]): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const sectionsByTimeslot = new Map<string, Section[]>();

  for (const section of sectionsInPlan) {
    for (const slot of section.slots) {
      const key = timeslotKey(slot);
      const current = sectionsByTimeslot.get(key) ?? [];
      current.push(section);
      sectionsByTimeslot.set(key, current);
    }
  }

  for (const [key, sections] of sectionsByTimeslot) {
    if (sections.length <= 3) {
      continue;
    }

    conflicts.push(
      conflict(
        ErrorCodes.MODEL_VOLUNTEER_LIMIT_TIMESLOT,
        sections.map((section) => section.sectionId),
        sections.map((section) => section.courseCode),
        `同一时间段 ${key} 的志愿教学班数量超过 3 个`,
      ),
    );
  }

  return conflicts;
}

function validateHardFields(sections: readonly Section[]): ConflictReport[] {
  const conflicts: ConflictReport[] = [];

  for (const section of sections) {
    if (section.examTime === null) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_MISSING_EXAM_TIME,
          [section.sectionId],
          [section.courseCode],
          "考试时间缺失的教学班不能进入方案",
        ),
      );
    }

    if (section.credits === null) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_MISSING_CREDIT,
          [section.sectionId],
          [section.courseCode],
          "学分缺失的教学班不能进入方案",
        ),
      );
    }
  }

  return conflicts;
}

function validateCreditLimit(sections: readonly Section[], creditLimit: number): ConflictReport[] {
  const creditsByCourse = new Map<
    CourseCode,
    { sectionIds: SectionId[]; credits: number | null }
  >();

  for (const section of sections) {
    const current = creditsByCourse.get(section.courseCode);
    if (current) {
      current.sectionIds.push(section.sectionId);
      if (current.credits === null) {
        current.credits = section.credits;
      }
      continue;
    }

    creditsByCourse.set(section.courseCode, {
      sectionIds: [section.sectionId],
      credits: section.credits,
    });
  }

  let totalCredits = 0;
  const involvedSectionIds: SectionId[] = [];
  const involvedCourseCodes: CourseCode[] = [];

  for (const [courseCode, entry] of creditsByCourse) {
    if (entry.credits === null) {
      continue;
    }

    totalCredits += entry.credits;
    involvedSectionIds.push(...entry.sectionIds);
    involvedCourseCodes.push(courseCode);
  }

  if (totalCredits <= creditLimit) {
    return [];
  }

  return [
    conflict(
      ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED,
      involvedSectionIds,
      involvedCourseCodes,
      `方案总学分 ${totalCredits} 超过用户上限 ${creditLimit}`,
    ),
  ];
}

function validateExamConflicts(sections: readonly Section[]): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const examSlots = new Map<string, Section>();

  for (const section of sections) {
    if (section.examTime === null) {
      continue;
    }

    const existing = examSlots.get(section.examTime.examKey);
    if (!existing) {
      examSlots.set(section.examTime.examKey, section);
      continue;
    }

    if (existing.courseCode !== section.courseCode) {
      conflicts.push(
        conflict(
          ErrorCodes.MODEL_EXAM_CONFLICT,
          [existing.sectionId, section.sectionId],
          [existing.courseCode, section.courseCode],
          "不同课程存在同一考试时间硬冲突",
        ),
      );
    }
  }

  return conflicts;
}

function courseCodesFor(input: SolverInput, sectionIds: readonly SectionId[]): CourseCode[] {
  return sectionIds.flatMap((sectionId) => {
    const section = input.sections.get(sectionId);
    return section ? [section.courseCode] : [];
  });
}

function conflict(
  errorCode: ErrorCode,
  involvedSectionIds: SectionId[],
  involvedCourseCodes: CourseCode[],
  description: string,
): ConflictReport {
  return {
    errorCode,
    involvedSectionIds: [...new Set(involvedSectionIds)],
    involvedCourseCodes: [...new Set(involvedCourseCodes)],
    description,
  };
}
