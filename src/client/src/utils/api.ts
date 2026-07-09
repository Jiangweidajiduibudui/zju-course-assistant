/**
 * Mock API 层 — 模拟后端响应
 * 当后端就绪后，替换此文件中的函数为真实 fetch 调用
 */
import type {
  Course, Teacher, Plan, PlanEntry, ConflictInfo, UserPreferences,
} from '@shared/contracts';
import type { PoolEntry } from '@shared/contracts';

// ============================================================
// Mock 教师数据（查老师）
// ============================================================

const MOCK_TEACHERS: Teacher[] = [
  {
    id: 't1', name: '张明远', department: '数学科学学院',
    rating: 4.8, avgGrade: 85, reviewCount: 326,
    tags: ['讲课清晰', '给分超好', '幽默风趣'],
    gradeDistribution: [2, 5, 12, 28, 35, 18],
    reviews: [
      { text: '张老师讲课非常清楚，板书工整，每节课都有收获。期末给分也很大方，强烈推荐！', course: '微积分（甲）I', date: '2025-06', rating: 5 },
      { text: '内容讲得很透彻，但小测有点多…不过最后给分确实不错', course: '微积分（甲）I', date: '2025-01', rating: 4 },
    ],
  },
  {
    id: 't2', name: '李建平', department: '数学科学学院',
    rating: 4.5, avgGrade: 82, reviewCount: 218,
    tags: ['认真负责', '难度适中', 'PPT详细'],
    gradeDistribution: [3, 8, 18, 30, 25, 16],
    reviews: [
      { text: '李老师很负责，每节课都有详细的PPT，考试难度适中，适合认真学的同学', course: '线性代数（甲）I', date: '2025-06', rating: 5 },
    ],
  },
  {
    id: 't3', name: '王浩然', department: '计算机科学与技术学院',
    rating: 4.2, avgGrade: 78, reviewCount: 187,
    tags: ['要求严格', '干货多', '作业多'],
    gradeDistribution: [8, 15, 25, 28, 18, 6],
    reviews: [
      { text: '王老师上课干货很多，但要求确实严格，作业量不小。学完收获很大，但过程比较痛苦', course: 'C程序设计基础', date: '2025-06', rating: 4 },
    ],
  },
  {
    id: 't4', name: '赵文博', department: '计算机科学与技术学院',
    rating: 4.6, avgGrade: 83, reviewCount: 156,
    tags: ['温和耐心', '代码示范多', '给分公正'],
    gradeDistribution: [2, 6, 20, 32, 28, 12],
    reviews: [
      { text: '赵老师特别耐心，每次实验课都会一个个帮看代码，期末项目给分也很公正', course: 'C程序设计基础', date: '2025-06', rating: 5 },
    ],
  },
  {
    id: 't5', name: '陈丽华', department: '物理学系',
    rating: 4.6, avgGrade: 80, reviewCount: 243,
    tags: ['实验演示丰富', '概念清晰', '考前划重点'],
    gradeDistribution: [4, 10, 22, 30, 24, 10],
    reviews: [
      { text: '物理课本来很枯燥，但陈老师的实验演示让概念变得直观。考前会划重点，很良心', course: '大学物理（甲）I', date: '2025-06', rating: 5 },
    ],
  },
  {
    id: 't6', name: '刘思远', department: '物理学系',
    rating: 4.0, avgGrade: 75, reviewCount: 132,
    tags: ['中规中矩', '考试难', '不点名'],
    gradeDistribution: [10, 18, 28, 25, 14, 5],
    reviews: [
      { text: '上课中规中矩吧，考试有点难，但老师不点名，适合自学的同学', course: '大学物理（甲）I', date: '2025-01', rating: 3 },
    ],
  },
  {
    id: 't7', name: '孙晓萌', department: '外国语学院',
    rating: 4.7, avgGrade: 86, reviewCount: 298,
    tags: ['课堂互动多', '发音标准', '给分大方'],
    gradeDistribution: [1, 4, 10, 28, 36, 21],
    reviews: [
      { text: '最好的英语老师！课堂气氛活跃，互动很多，完全不枯燥。期末给分也很大方！', course: '大学英语III', date: '2025-06', rating: 5 },
    ],
  },
  {
    id: 't8', name: '周建国', department: '马克思主义学院',
    rating: 4.3, avgGrade: 84, reviewCount: 175,
    tags: ['不枯燥', '案例丰富', '论文给分高'],
    gradeDistribution: [2, 5, 15, 32, 30, 16],
    reviews: [
      { text: '没想到马原课还能这么有趣，周老师用了很多当下的案例，论文给分也不低', course: '马克思主义基本原理', date: '2025-06', rating: 4 },
    ],
  },
  {
    id: 't9', name: '黄志强', department: '马克思主义学院',
    rating: 3.8, avgGrade: 79, reviewCount: 112,
    tags: ['照本宣科', '签到严格', '论文要求多'],
    gradeDistribution: [6, 14, 30, 28, 16, 6],
    reviews: [
      { text: '比较传统的老师，基本上照着PPT念。签到比较严格，论文要求也很多', course: '马克思主义基本原理', date: '2025-01', rating: 3 },
    ],
  },
  {
    id: 't10', name: '吴教练', department: '公共体育与艺术部',
    rating: 4.5, avgGrade: 88, reviewCount: 203,
    tags: ['轻松愉快', '运动量适中', '好过'],
    gradeDistribution: [0, 1, 8, 22, 40, 29],
    reviews: [
      { text: '篮球课很好玩，吴教练人也很nice，只要出勤够、基本动作会了就给过，分数还高', course: '篮球（初级班）', date: '2025-06', rating: 5 },
    ],
  },
];

// ============================================================
// Mock 课程数据
// ============================================================

const MOCK_COURSES: Course[] = [
  {
    id: 'c1', name: '微积分（甲）I', code: 'MATH1001', credits: 5, category: '通识必修',
    teachingClasses: [
      { id: 's1a', courseId: 'c1', teacherId: 't1', timeSlots: [{ day: 1, startPeriod: 1, endPeriod: 2, weeks: '1-16', location: '紫金港 东1A-303' }], capacity: 120, enrolled: 85 },
      { id: 's1b', courseId: 'c1', teacherId: 't1', timeSlots: [{ day: 3, startPeriod: 1, endPeriod: 2, weeks: '1-16', location: '紫金港 东1A-305' }], capacity: 120, enrolled: 72 },
    ],
  },
  {
    id: 'c2', name: '线性代数（甲）I', code: 'MATH1002', credits: 3.5, category: '通识必修',
    teachingClasses: [
      { id: 's2a', courseId: 'c2', teacherId: 't2', timeSlots: [{ day: 2, startPeriod: 3, endPeriod: 5, weeks: '1-16', location: '紫金港 东2-201' }], capacity: 100, enrolled: 68 },
      { id: 's2b', courseId: 'c2', teacherId: 't2', timeSlots: [{ day: 4, startPeriod: 3, endPeriod: 5, weeks: '1-16', location: '紫金港 东2-203' }], capacity: 100, enrolled: 55 },
    ],
  },
  {
    id: 'c3', name: 'C程序设计基础', code: 'CSCI1001', credits: 3, category: '专业必修',
    teachingClasses: [
      { id: 's3a', courseId: 'c3', teacherId: 't3', timeSlots: [{ day: 1, startPeriod: 6, endPeriod: 7, weeks: '1-16', location: '紫金港 计算中心301' }], capacity: 80, enrolled: 62 },
      { id: 's3b', courseId: 'c3', teacherId: 't4', timeSlots: [{ day: 3, startPeriod: 6, endPeriod: 7, weeks: '1-16', location: '紫金港 计算中心302' }], capacity: 80, enrolled: 70 },
      { id: 's3c', courseId: 'c3', teacherId: 't4', timeSlots: [{ day: 5, startPeriod: 3, endPeriod: 5, weeks: '1-16', location: '紫金港 计算中心303' }], capacity: 60, enrolled: 35 },
    ],
  },
  {
    id: 'c4', name: '大学物理（甲）I', code: 'PHYS1001', credits: 4, category: '通识必修',
    teachingClasses: [
      { id: 's4a', courseId: 'c4', teacherId: 't5', timeSlots: [{ day: 2, startPeriod: 1, endPeriod: 2, weeks: '1-16', location: '紫金港 西1-101' }], capacity: 130, enrolled: 95 },
      { id: 's4b', courseId: 'c4', teacherId: 't6', timeSlots: [{ day: 4, startPeriod: 1, endPeriod: 2, weeks: '1-16', location: '紫金港 西1-103' }], capacity: 130, enrolled: 60 },
    ],
  },
  {
    id: 'c5', name: '大学英语III', code: 'ENGL2003', credits: 2, category: '通识必修',
    teachingClasses: [
      { id: 's5a', courseId: 'c5', teacherId: 't7', timeSlots: [{ day: 1, startPeriod: 3, endPeriod: 5, weeks: '1-16', location: '紫金港 外语楼301' }], capacity: 40, enrolled: 38 },
      { id: 's5b', courseId: 'c5', teacherId: 't7', timeSlots: [{ day: 3, startPeriod: 3, endPeriod: 5, weeks: '1-16', location: '紫金港 外语楼302' }], capacity: 40, enrolled: 32 },
    ],
  },
  {
    id: 'c6', name: '马克思主义基本原理', code: 'MARX2001', credits: 3, category: '通识必修',
    teachingClasses: [
      { id: 's6a', courseId: 'c6', teacherId: 't8', timeSlots: [{ day: 2, startPeriod: 8, endPeriod: 9, weeks: '1-16', location: '紫金港 东2-101' }], capacity: 150, enrolled: 120 },
      { id: 's6b', courseId: 'c6', teacherId: 't9', timeSlots: [{ day: 4, startPeriod: 8, endPeriod: 9, weeks: '1-16', location: '紫金港 东2-102' }], capacity: 150, enrolled: 95 },
    ],
  },
  {
    id: 'c7', name: '军事理论', code: 'MILI1001', credits: 2, category: '通识必修',
    teachingClasses: [
      { id: 's7a', courseId: 'c7', teacherId: 't8', timeSlots: [{ day: 5, startPeriod: 1, endPeriod: 2, weeks: '1-8', location: '紫金港 东2-201' }], capacity: 200, enrolled: 180 },
    ],
  },
  {
    id: 'c8', name: '篮球（初级班）', code: 'PE1003', credits: 1, category: '体育',
    teachingClasses: [
      { id: 's8a', courseId: 'c8', teacherId: 't10', timeSlots: [{ day: 3, startPeriod: 8, endPeriod: 9, weeks: '1-16', location: '紫金港 体育馆A' }], capacity: 30, enrolled: 25 },
      { id: 's8b', courseId: 'c8', teacherId: 't10', timeSlots: [{ day: 5, startPeriod: 6, endPeriod: 7, weeks: '1-16', location: '紫金港 体育馆B' }], capacity: 30, enrolled: 18 },
    ],
  },
  {
    id: 'c9', name: '中国近现代史纲要', code: 'HIST2001', credits: 2, category: '通识必修',
    teachingClasses: [
      { id: 's9a', courseId: 'c9', teacherId: 't8', timeSlots: [{ day: 1, startPeriod: 8, endPeriod: 9, weeks: '1-16', location: '紫金港 东2-301' }], capacity: 180, enrolled: 150 },
    ],
  },
  {
    id: 'c10', name: '形势与政策I', code: 'POLI1001', credits: 1, category: '通识必修',
    teachingClasses: [
      { id: 's10a', courseId: 'c10', teacherId: 't9', timeSlots: [{ day: 5, startPeriod: 8, endPeriod: 9, weeks: '1-8', location: '紫金港 东2-401' }], capacity: 200, enrolled: 190 },
    ],
  },
  {
    id: 'c11', name: '概率论与数理统计', code: 'MATH2003', credits: 3, category: '专业必修',
    teachingClasses: [
      { id: 's11a', courseId: 'c11', teacherId: 't1', timeSlots: [{ day: 2, startPeriod: 6, endPeriod: 7, weeks: '1-16', location: '紫金港 东1A-201' }], capacity: 100, enrolled: 78 },
      { id: 's11b', courseId: 'c11', teacherId: 't2', timeSlots: [{ day: 4, startPeriod: 6, endPeriod: 7, weeks: '1-16', location: '紫金港 东1A-203' }], capacity: 100, enrolled: 65 },
    ],
  },
  {
    id: 'c12', name: '数据结构基础', code: 'CSCI2001', credits: 3.5, category: '专业必修',
    teachingClasses: [
      { id: 's12a', courseId: 'c12', teacherId: 't4', timeSlots: [{ day: 2, startPeriod: 11, endPeriod: 13, weeks: '1-16', location: '紫金港 计算中心201' }], capacity: 70, enrolled: 55 },
      { id: 's12b', courseId: 'c12', teacherId: 't3', timeSlots: [{ day: 4, startPeriod: 11, endPeriod: 13, weeks: '1-16', location: '紫金港 计算中心202' }], capacity: 70, enrolled: 48 },
    ],
  },
];

// ============================================================
// Mock API 函数
// ============================================================

/** 模拟网络延迟 */
function delay(ms = 200): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchCourses(): Promise<Course[]> {
  await delay(150);
  return JSON.parse(JSON.stringify(MOCK_COURSES));
}

export async function fetchTeachers(): Promise<Teacher[]> {
  await delay(150);
  return JSON.parse(JSON.stringify(MOCK_TEACHERS));
}

export async function fetchTeacher(teacherId: string): Promise<Teacher | null> {
  await delay(100);
  return MOCK_TEACHERS.find((t) => t.id === teacherId) || null;
}

// ============================================================
// 方案生成（模拟确定性求解器 + LLM 排序的核心链路）
// ============================================================

interface TimeBlock {
  day: number;
  startPeriod: number;
  endPeriod: number;
}

/** 两个时间段是否重叠 */
function timeOverlap(a: TimeBlock, b: TimeBlock): boolean {
  if (a.day !== b.day) return false;
  return a.startPeriod <= b.endPeriod && b.startPeriod <= a.endPeriod;
}

/** 检查方案中是否有时间冲突 */
export function detectConflicts(entries: PlanEntry[]): ConflictInfo[] {
  const conflicts: ConflictInfo[] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      for (const sa of a.timeSlots) {
        for (const sb of b.timeSlots) {
          if (timeOverlap(sa, sb)) {
            conflicts.push({
              type: 'time',
              courseIds: [a.courseId, b.courseId],
              detail: `${a.courseName} 与 ${b.courseName} 在 周${sa.day} 第${sa.startPeriod}-${sa.endPeriod}节 时间冲突`,
            });
          }
        }
      }
    }
  }
  return conflicts;
}

/** 评分一个教学班（用于排序） */
function scoreSection(
  sectionId: string,
  courseId: string,
  occupied: Map<string, string>,
  courses: Course[],
  teachers: Teacher[],
  preferences: UserPreferences
): number {
  const course = courses.find((c) => c.id === courseId);
  const tc = course?.teachingClasses.find((s) => s.id === sectionId);
  if (!tc) return -Infinity;

  const teacher = teachers.find((t) => t.id === tc.teacherId);
  let score = 0;

  // 教师评分 (0-50)
  if (teacher) score += teacher.rating * 10 * (preferences.teacherWeight / 8);

  // 时间偏好
  for (const slot of tc.timeSlots) {
    const key = `${slot.day}-${slot.startPeriod}`;
    if (occupied.has(key)) return -Infinity; // 硬冲突

    // 时段打分
    if (slot.startPeriod <= 2) {
      score += preferences.avoidEarlyMorning ? -20 : 6;
    } else if (slot.startPeriod <= 5) {
      score += 10;
    } else if (slot.startPeriod <= 7) {
      score += 6;
    } else if (slot.startPeriod <= 9) {
      score += 7;
    } else {
      score += preferences.avoidLateEvening ? -15 : 3;
    }
  }

  // 余量加分
  if (tc.enrolled / tc.capacity < 0.5) score += 5;
  else if (tc.enrolled / tc.capacity > 0.9) score -= 3;

  return score;
}

/**
 * 模拟方案生成流程：
 * ⑥ 确定性终校验（Schema、池内性、锁定保持、冲突、覆盖）
 * 当后端就绪后，替换为 POST /api/planner/generate 调用
 */
export async function generatePlan(
  pool: PoolEntry[],
  lockedPlan: Plan | null,
  planLocked: boolean,
  preferences: UserPreferences,
  courses: Course[],
  teachers: Teacher[]
): Promise<{ plan: Plan; conflicts: ConflictInfo[] }> {
  await delay(600); // 模拟求解耗时

  const occupied = new Map<string, string>(); // key "day-period" → sectionId
  const entries: PlanEntry[] = [];
  const colorIdx = 0;

  // 先保留已锁定的条目
  const lockedEntries: PlanEntry[] = [];
  if (planLocked && lockedPlan) {
    for (const e of lockedPlan.entries) {
      if (e.locked) {
        lockedEntries.push(e);
        for (const slot of e.timeSlots) {
          occupied.set(`${slot.day}-${slot.startPeriod}`, e.sectionId);
        }
      }
    }
  }

  // 排序候选池：教学班选项少的课程优先放置
  const sortedPool = [...pool].sort((a, b) => {
    const ac = courses.find((c) => c.id === a.courseId);
    const bc = courses.find((c) => c.id === b.courseId);
    return (ac?.teachingClasses.length || 99) - (bc?.teachingClasses.length || 99);
  });

  const conflictedCourses: PlanEntry[] = [];

  for (const item of sortedPool) {
    // 跳过已锁定条目对应的课程
    if (lockedEntries.some((e) => e.courseId === item.courseId)) continue;

    const course = courses.find((c) => c.id === item.courseId);
    if (!course) continue;

    const tc = course.teachingClasses.find((s) => s.id === item.sectionId);
    if (!tc) continue;

    // 检查是否与已占用的时间段冲突
    let hasConflict = false;
    for (const slot of tc.timeSlots) {
      if (occupied.has(`${slot.day}-${slot.startPeriod}`)) {
        hasConflict = true;
        break;
      }
    }

    if (hasConflict) {
      // 尝试其他教学班
      let placed = false;
      const scored = course.teachingClasses
        .map((s) => ({ sid: s.id, score: scoreSection(s.id, course.id, occupied, courses, teachers, preferences) }))
        .filter((s) => s.score > -Infinity)
        .sort((a, b) => b.score - a.score);

      for (const alt of scored) {
        const altTc = course.teachingClasses.find((s) => s.id === alt.sid);
        if (!altTc) continue;
        let altConflict = false;
        for (const slot of altTc.timeSlots) {
          if (occupied.has(`${slot.day}-${slot.startPeriod}`)) {
            altConflict = true;
            break;
          }
        }
        if (!altConflict) {
          const teacher = teachers.find((t) => t.id === altTc.teacherId);
          const entry: PlanEntry = {
            courseId: course.id,
            courseName: course.name,
            sectionId: altTc.id,
            teacherId: altTc.teacherId,
            teacherName: teacher?.name || '未知',
            teacherRating: teacher?.rating || null,
            timeSlots: altTc.timeSlots,
            credits: course.credits,
            locked: false,
          };
          entries.push(entry);
          for (const slot of altTc.timeSlots) {
            occupied.set(`${slot.day}-${slot.startPeriod}`, altTc.id);
          }
          placed = true;
          break;
        }
      }
      if (!placed) {
        const teacher = teachers.find((t) => t.id === tc.teacherId);
        conflictedCourses.push({
          courseId: course.id,
          courseName: course.name,
          sectionId: tc.id,
          teacherId: tc.teacherId,
          teacherName: teacher?.name || '未知',
          teacherRating: teacher?.rating || null,
          timeSlots: tc.timeSlots,
          credits: course.credits,
          locked: false,
        });
      }
    } else {
      const teacher = teachers.find((t) => t.id === tc.teacherId);
      const entry: PlanEntry = {
        courseId: course.id,
        courseName: course.name,
        sectionId: tc.id,
        teacherId: tc.teacherId,
        teacherName: teacher?.name || '未知',
        teacherRating: teacher?.rating || null,
        timeSlots: tc.timeSlots,
        credits: course.credits,
        locked: false,
      };
      entries.push(entry);
      for (const slot of tc.timeSlots) {
        occupied.set(`${slot.day}-${slot.startPeriod}`, tc.id);
      }
    }
  }

  // 合并锁定条目和新建条目
  const allEntries = [...lockedEntries, ...entries];

  // 确定性终校验
  const conflicts = detectConflicts(allEntries);

  const plan: Plan = {
    id: `plan-${Date.now()}`,
    entries: allEntries,
    createdAt: new Date().toISOString(),
  };

  return { plan, conflicts };
}

// ============================================================
// 方案重新优化（保留锁定条目，最小扰动）
// ============================================================

export async function reoptimizePlan(
  pool: PoolEntry[],
  currentPlan: Plan,
  preferences: UserPreferences,
  courses: Course[],
  teachers: Teacher[]
): Promise<{ plan: Plan; diff: string[] }> {
  await delay(500);

  const { plan: newPlan, conflicts } = await generatePlan(
    pool,
    currentPlan,
    true, // 视为已锁定，保留 locked=true 的条目
    preferences,
    courses,
    teachers
  );

  // 计算 diff
  const diff: string[] = [];
  const oldMap = new Map(currentPlan.entries.map((e) => [e.courseId, e]));
  const newMap = new Map(newPlan.entries.map((e) => [e.courseId, e]));

  for (const [cid, ne] of newMap) {
    const oe = oldMap.get(cid);
    if (!oe) {
      diff.push(`+ 新增：${ne.courseName}`);
    } else if (oe.sectionId !== ne.sectionId) {
      diff.push(`~ 调整：${ne.courseName}（${oe.teacherName} → ${ne.teacherName}）`);
    }
  }
  for (const [cid, oe] of oldMap) {
    if (!newMap.has(cid)) {
      diff.push(`- 移除：${oe.courseName}`);
    }
  }

  return { plan: newPlan, diff };
}
