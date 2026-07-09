import { type CandidatePlan, ErrorCodes } from "../../shared/contracts/index.js";
import type { ConflictReport } from "../../shared/contracts/index.js";
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
  const { sections, pool, baseline, rules, lockedSectionIds } = input;
  const conflicts: ConflictReport[] = [];

  // —— 步骤 1：防御性复查关键字段 ——
  if (!plan.planId || plan.volunteers.length === 0) {
    conflicts.push({
      errorCode: ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
      involvedSectionIds: [],
      involvedCourseCodes: [],
      description: "方案缺少 planId 或无任何志愿",
    });
    return { kind: "invalid", conflicts };
  }

  // 构建快速查找
  const poolSectionIds = new Set<string>();
  const poolCourseCodes = new Set<string>();
  for (const target of pool.targets) {
    poolCourseCodes.add(target.courseCode);
    for (const sid of target.candidateSectionIds) {
      poolSectionIds.add(sid);
    }
  }

  // baseline selected + volunteers 的 sectionId 集合（锁定项）
  const baselineLockedIds = new Set<string>([
    ...baseline.selected,
    ...baseline.volunteers.map((v) => v.sectionId),
  ]);

  // —— 步骤 2：教学班 ID 存在性与池内性 ——
  for (const vol of plan.volunteers) {
    if (!sections.has(vol.sectionId)) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_SECTION_NOT_IN_POOL,
        involvedSectionIds: [vol.sectionId],
        involvedCourseCodes: [vol.courseCode],
        description: `教学班 ${vol.sectionId} 不存在于 sections 中`,
      });
    } else if (!poolSectionIds.has(vol.sectionId)) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_SECTION_NOT_IN_POOL,
        involvedSectionIds: [vol.sectionId],
        involvedCourseCodes: [vol.courseCode],
        description: `教学班 ${vol.sectionId} 不在待选池中`,
      });
    }
  }

  if (conflicts.length > 0) {
    return { kind: "invalid", conflicts };
  }

  // —— 步骤 3：课程覆盖 ——
  const coveredCourseCodes = new Set(plan.volunteers.map((v) => v.courseCode));

  for (const courseCode of poolCourseCodes) {
    if (!coveredCourseCodes.has(courseCode)) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
        involvedSectionIds: [],
        involvedCourseCodes: [courseCode],
        description: `待选池目标课程 ${courseCode} 无任何志愿覆盖`,
      });
    }
  }

  if (conflicts.length > 0) {
    return { kind: "invalid", conflicts };
  }

  // —— 步骤 4：志愿组约束（≤3 且顺位唯一）——
  // 按课程分组检查
  const byCourse = new Map<string, number[]>();
  // 按时段分组检查（用 volunteer 所在 section 的 slots）
  const byTimeslot = new Map<string, number[]>();

  for (const vol of plan.volunteers) {
    // 课程组检查
    const courseBucket = byCourse.get(vol.courseCode) ?? [];
    if (courseBucket.includes(vol.rank)) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_VOLUNTEER_LIMIT_COURSE,
        involvedSectionIds: [vol.sectionId],
        involvedCourseCodes: [vol.courseCode],
        description: `课程 ${vol.courseCode} 存在重复顺位 ${vol.rank}`,
      });
    } else {
      courseBucket.push(vol.rank);
      byCourse.set(vol.courseCode, courseBucket);
      if (courseBucket.length > 3) {
        conflicts.push({
          errorCode: ErrorCodes.MODEL_VOLUNTEER_LIMIT_COURSE,
          involvedSectionIds: [vol.sectionId],
          involvedCourseCodes: [vol.courseCode],
          description: `课程 ${vol.courseCode} 志愿组超过 3 个教学班`,
        });
      }
    }

    // 时间槽组检查
    const section = sections.get(vol.sectionId);
    if (section) {
      for (const slot of section.slots) {
        const tsKey = `${slot.term}-${slot.dayOfWeek}-${slot.period}`;
        const tsBucket = byTimeslot.get(tsKey) ?? [];
        if (!tsBucket.includes(vol.rank)) {
          tsBucket.push(vol.rank);
          byTimeslot.set(tsKey, tsBucket);
          if (tsBucket.length > 3) {
            conflicts.push({
              errorCode: ErrorCodes.MODEL_VOLUNTEER_LIMIT_TIMESLOT,
              involvedSectionIds: [vol.sectionId],
              involvedCourseCodes: [vol.courseCode],
              description: `时间槽 ${tsKey} 志愿组超过 3 个教学班`,
            });
          }
        }
      }
    }
  }

  // —— 步骤 5：锁定状态保持 ——
  // 5a: baseline.selected 必须全在 plan 中（固定不变）
  for (const selectedId of baseline.selected) {
    const found = plan.volunteers.find((v) => v.sectionId === selectedId);
    if (!found) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_LOCK_VIOLATION,
        involvedSectionIds: [selectedId],
        involvedCourseCodes: [],
        description: `已选教学班 ${selectedId} 在方案中缺失（baseline.selected 不可移除）`,
      });
    }
  }

  // 5b: baseline.volunteers 的顺位锁定（AC-6.2）
  for (const baselineVol of baseline.volunteers) {
    const planVol = plan.volunteers.find((v) => v.sectionId === baselineVol.sectionId);
    if (planVol && planVol.rank !== baselineVol.rank) {
      // 仅在 plan 中仍存在时才检查顺位；如果不存在，上面的 selected 检查会触发
      if (!baseline.selected.includes(baselineVol.sectionId)) {
        conflicts.push({
          errorCode: ErrorCodes.MODEL_LOCK_VIOLATION,
          involvedSectionIds: [baselineVol.sectionId],
          involvedCourseCodes: [],
          description: `已填志愿 ${baselineVol.sectionId} 顺位从 ${baselineVol.rank} 变为 ${planVol.rank}（baseline 锁定）`,
        });
      }
    }
  }

  // 5c: 手动锁定（AC-7.1）
  for (const lockedId of lockedSectionIds) {
    const planVol = plan.volunteers.find((v) => v.sectionId === lockedId);
    if (!planVol) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_LOCK_VIOLATION,
        involvedSectionIds: [lockedId],
        involvedCourseCodes: [],
        description: `手动锁定的教学班 ${lockedId} 在方案中缺失`,
      });
    } else if (!planVol.locked) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_LOCK_VIOLATION,
        involvedSectionIds: [lockedId],
        involvedCourseCodes: [planVol.courseCode],
        description: `手动锁定的教学班 ${lockedId} 的 locked 标记丢失`,
      });
    }
  }

  // —— 步骤 6：硬约束 ——
  // 6a: 考试冲突检查（不同课程不得同一考试时间）
  const examGroups = new Map<string, Array<{ sectionId: string; courseCode: string }>>();
  for (const vol of plan.volunteers) {
    const section = sections.get(vol.sectionId);
    if (!section) continue;
    if (section.examTime) {
      const bucket = examGroups.get(section.examTime.examKey) ?? [];
      bucket.push({ sectionId: vol.sectionId, courseCode: vol.courseCode });
      examGroups.set(section.examTime.examKey, bucket);
    }
  }

  for (const [examKey, entries] of examGroups.entries()) {
    if (entries.length < 2) continue;
    const distinctCourses = new Set(entries.map((e) => e.courseCode));
    if (distinctCourses.size > 1) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_EXAM_CONFLICT,
        involvedSectionIds: entries.map((e) => e.sectionId),
        involvedCourseCodes: [...distinctCourses],
        description: `考试时段 ${examKey} 存在不同课程的教学班冲突`,
      });
    }
  }

  // 6b: 学分上限检查
  if (rules.creditLimit === null) {
    conflicts.push({
      errorCode: ErrorCodes.MODEL_CREDIT_LIMIT_MISSING,
      involvedSectionIds: [],
      involvedCourseCodes: [],
      description: "学分上限未填写，不能生成推荐",
    });
  } else {
    let totalCredits = 0;
    for (const vol of plan.volunteers) {
      const section = sections.get(vol.sectionId);
      if (section && section.credits !== null) {
        totalCredits += section.credits;
      }
    }
    if (totalCredits > rules.creditLimit) {
      conflicts.push({
        errorCode: ErrorCodes.MODEL_CREDIT_LIMIT_EXCEEDED,
        involvedSectionIds: [],
        involvedCourseCodes: [],
        description: `总学分 ${totalCredits} 超过上限 ${rules.creditLimit}`,
      });
    }
  }

  // 6c: 规则栏硬约束 —— forbid timeslot
  for (const bar of rules.bars) {
    for (const constraint of bar.hardConstraints) {
      if (constraint.kind !== "forbid") continue;

      if (constraint.expr.type === "timeslot") {
        const { dayOfWeek, period } = constraint.expr;
        const matchingVol = plan.volunteers.find((vol) => {
          const section = sections.get(vol.sectionId);
          return section?.slots.some(
            (s) => s.dayOfWeek === dayOfWeek && s.period === period,
          );
        });
        if (matchingVol) {
          conflicts.push({
            errorCode: ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
            involvedSectionIds: [matchingVol.sectionId],
            involvedCourseCodes: [matchingVol.courseCode],
            description: `规则栏 bar=${bar.id} 禁止星期${dayOfWeek}第${period}节，但教学班 ${matchingVol.sectionId} 占用该时段`,
          });
        }
      } else {
        // forbid teacher constraint (expr.type === "teacher" after timeslot check)
        const teacherExpr = constraint.expr as { type: "teacher"; teacherName: string };
        const matchingVol = plan.volunteers.find((vol) => {
          const section = sections.get(vol.sectionId);
          return section?.teachers.includes(teacherExpr.teacherName);
        });
        if (matchingVol) {
          conflicts.push({
            errorCode: ErrorCodes.MODEL_NO_FEASIBLE_PLAN,
            involvedSectionIds: [matchingVol.sectionId],
            involvedCourseCodes: [matchingVol.courseCode],
            description: `规则栏 bar=${bar.id} 禁止教师 ${teacherExpr.teacherName}，但教学班 ${matchingVol.sectionId} 包含该教师`,
          });
        }
      }
    }
  }

  if (conflicts.length > 0) {
    return { kind: "invalid", conflicts };
  }

  return { kind: "valid" };
}
