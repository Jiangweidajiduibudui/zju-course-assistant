// ============================================================
// 核心领域类型 — 前端与后端共享的单一数据契约
// 权威来源：docs/04-AI与技术架构设计.md §2–§4
// ============================================================

/** 时间段 */
export interface TimeSlot {
  day: number;        // 1-7 (周一至周日)
  startPeriod: number;
  endPeriod: number;
  weeks: string;      // "1-16" 或 "1-8"
  location: string;   // 教室
}

/** 教学班 */
export interface TeachingClass {
  id: string;
  courseId: string;
  teacherId: string;
  timeSlots: TimeSlot[];
  capacity: number;
  enrolled: number;
}

/** 课程 */
export interface Course {
  id: string;
  name: string;
  code: string;
  credits: number;
  category: string;
  teachingClasses: TeachingClass[];
}

/** 教师（查老师数据） */
export interface Teacher {
  id: string;
  name: string;
  department: string;
  rating: number;          // 1-5 综合评分
  avgGrade: number;        // 按课均绩
  reviewCount: number;
  tags: string[];
  gradeDistribution: number[]; // [<60, 60-69, 70-79, 80-89, 90-95, >95]
  reviews: TeacherReview[];
}

export interface TeacherReview {
  text: string;
  course: string;
  date: string;
  rating: number;
}

// ============================================================
// 候选池
// ============================================================

export interface PoolEntry {
  courseId: string;
  sectionId: string;
}

// ============================================================
// 推荐方案
// ============================================================

export interface PlanEntry {
  courseId: string;
  courseName: string;
  sectionId: string;
  teacherId: string;
  teacherName: string;
  teacherRating: number | null;
  timeSlots: TimeSlot[];
  credits: number;
  locked: boolean;         // 单条锁定 — 重新优化时不动
}

export interface Plan {
  id: string;
  entries: PlanEntry[];
  createdAt: string;       // ISO 8601
}

// ============================================================
// 冲突
// ============================================================

export type ConflictType = 'time' | 'credit' | 'exam';

export interface ConflictInfo {
  type: ConflictType;
  courseIds: [string, string];
  detail: string;
}

// ============================================================
// 用户偏好
// ============================================================

export interface UserPreferences {
  /** 时间偏好权重 (0-10)，越高越倾向好时段 */
  timeWeight: number;
  /** 教师评分权重 (0-10) */
  teacherWeight: number;
  /** 课业均匀分布权重 (0-10) */
  balanceWeight: number;
  /** 避开早八 */
  avoidEarlyMorning: boolean;
  /** 避开晚课 */
  avoidLateEvening: boolean;
  /** 偏好天数集中 */
  preferCompactDays: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  timeWeight: 5,
  teacherWeight: 8,
  balanceWeight: 5,
  avoidEarlyMorning: false,
  avoidLateEvening: false,
  preferCompactDays: false,
};

// ============================================================
// 会话 / 基线
// ============================================================

export interface BaselineEntry {
  courseId: string;
  courseName: string;
  sectionId: string;
  status: 'enrolled' | 'volunteered';
  order?: number; // 志愿顺序（仅 volunteered）
}

export interface Baseline {
  enrolled: BaselineEntry[];    // 已选上的课
  volunteered: BaselineEntry[]; // 已填志愿
  capturedAt: string;           // ISO 8601
}

// ============================================================
// 状态快照（用于回滚）
// ============================================================

export interface Snapshot {
  pool: PoolEntry[];
  plan: Plan | null;
  planLocked: boolean;
}

// ============================================================
// API 响应包装
// ============================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
