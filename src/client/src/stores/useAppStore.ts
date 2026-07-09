import { create } from 'zustand';
import type {
  Course, Teacher, PoolEntry, Plan, PlanEntry,
  ConflictInfo, UserPreferences, Snapshot, Baseline,
} from '@shared/contracts';
import { DEFAULT_PREFERENCES } from '@shared/contracts';

// ============================================================
// Store 类型
// ============================================================

export interface ToastMessage {
  id: string;
  text: string;
  type: 'success' | 'warning' | 'error' | 'info';
}

export interface AppState {
  // --- 隐私 ---
  consentGiven: boolean;
  giveConsent: () => void;

  // --- 数据 ---
  courses: Course[];
  teachers: Teacher[];
  setCourses: (courses: Course[]) => void;
  setTeachers: (teachers: Teacher[]) => void;

  // --- 导入 ---
  baseline: Baseline | null;
  importBaseline: (baseline: Baseline) => void;
  clearBaseline: () => void;

  // --- 候选池 ---
  pool: PoolEntry[];
  addToPool: (courseId: string, sectionId?: string) => void;
  removeFromPool: (courseId: string) => void;
  updatePoolSection: (courseId: string, sectionId: string) => void;
  clearPool: () => void;

  // --- 方案 ---
  plan: Plan | null;
  planLocked: boolean;
  planConflicts: ConflictInfo[];
  setPlan: (plan: Plan) => void;
  toggleEntryLock: (courseId: string) => void;
  lockPlan: () => void;
  unlockPlan: () => void;
  clearPlan: () => void;
  setPlanConflicts: (conflicts: ConflictInfo[]) => void;

  // --- 回滚 ---
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  takeSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // --- 设置 ---
  llmKey: string;
  preferences: UserPreferences;
  setLLMKey: (key: string) => void;
  setPreferences: (prefs: Partial<UserPreferences>) => void;

  // --- UI ---
  toasts: ToastMessage[];
  addToast: (text: string, type?: ToastMessage['type']) => void;
  dismissToast: (id: string) => void;
}

// ============================================================
// Store 实现
// ============================================================

let toastCounter = 0;

export const useAppStore = create<AppState>((set, get) => ({
  // --- 隐私 ---
  consentGiven: localStorage.getItem('zju-consent') === 'true',
  giveConsent: () => {
    localStorage.setItem('zju-consent', 'true');
    set({ consentGiven: true });
  },

  // --- 数据 ---
  courses: [],
  teachers: [],
  setCourses: (courses) => set({ courses }),
  setTeachers: (teachers) => set({ teachers }),

  // --- 导入 ---
  baseline: null,
  importBaseline: (baseline) => {
    get().takeSnapshot();
    set({ baseline });
    get().addToast('基线数据已导入', 'success');
  },
  clearBaseline: () => {
    get().takeSnapshot();
    set({ baseline: null });
  },

  // --- 候选池 ---
  pool: [],
  addToPool: (courseId, sectionId) => {
    const { courses, pool, takeSnapshot } = get();
    const course = courses.find((c) => c.id === courseId);
    if (!course) return;

    // 避免重复
    if (pool.some((p) => p.courseId === courseId)) return;

    // 默认选评分最高的教学班
    let bestSid = sectionId || course.teachingClasses[0]?.id || '';
    if (!sectionId) {
      let bestRating = 0;
      for (const tc of course.teachingClasses) {
        const t = get().teachers.find((t) => t.id === tc.teacherId);
        if (t && t.rating > bestRating) {
          bestRating = t.rating;
          bestSid = tc.id;
        }
      }
    }

    takeSnapshot();
    set({ pool: [...pool, { courseId, sectionId: bestSid }] });
    get().addToast(`已加入候选：${course.name}`, 'info');
  },

  removeFromPool: (courseId) => {
    const { pool, takeSnapshot } = get();
    takeSnapshot();
    set({ pool: pool.filter((p) => p.courseId !== courseId) });
    // 同时从方案中移除
    const plan = get().plan;
    if (plan) {
      set({
        plan: {
          ...plan,
          entries: plan.entries.filter((e) => e.courseId !== courseId),
        },
      });
    }
  },

  updatePoolSection: (courseId, sectionId) => {
    const { pool, takeSnapshot } = get();
    takeSnapshot();
    set({
      pool: pool.map((p) =>
        p.courseId === courseId ? { ...p, sectionId } : p
      ),
    });
  },

  clearPool: () => {
    get().takeSnapshot();
    set({ pool: [], plan: null, planLocked: false, planConflicts: [] });
  },

  // --- 方案 ---
  plan: null,
  planLocked: false,
  planConflicts: [],
  setPlan: (plan) => {
    get().takeSnapshot();
    set({ plan, planConflicts: [] });
  },
  toggleEntryLock: (courseId) => {
    const plan = get().plan;
    if (!plan) return;
    get().takeSnapshot();
    set({
      plan: {
        ...plan,
        entries: plan.entries.map((e) =>
          e.courseId === courseId ? { ...e, locked: !e.locked } : e
        ),
      },
    });
  },
  lockPlan: () => {
    const plan = get().plan;
    if (!plan) return;
    get().takeSnapshot();
    // 锁定所有条目
    set({
      plan: {
        ...plan,
        entries: plan.entries.map((e) => ({ ...e, locked: true })),
      },
      planLocked: true,
    });
    get().addToast('方案已定稿，重新优化不会改动已锁定条目', 'success');
  },
  unlockPlan: () => {
    get().takeSnapshot();
    set({ planLocked: false });
  },
  clearPlan: () => {
    get().takeSnapshot();
    set({ plan: null, planLocked: false, planConflicts: [] });
  },
  setPlanConflicts: (conflicts) => set({ planConflicts: conflicts }),

  // --- 回滚 ---
  undoStack: [],
  redoStack: [],
  takeSnapshot: () => {
    const { pool, plan, planLocked, undoStack } = get();
    const snapshot: Snapshot = {
      pool: [...pool],
      plan: plan ? { ...plan, entries: [...plan.entries] } : null,
      planLocked,
    };
    const newStack = [...undoStack, snapshot];
    // 最多保留 20 步
    if (newStack.length > 20) newStack.shift();
    set({ undoStack: newStack, redoStack: [] });
  },
  undo: () => {
    const { undoStack, pool, plan, planLocked, redoStack } = get();
    if (undoStack.length === 0) {
      get().addToast('没有更早的操作可回退', 'warning');
      return;
    }
    const snapshot = undoStack[undoStack.length - 1];
    const currentSnapshot: Snapshot = {
      pool: [...pool],
      plan: plan ? { ...plan, entries: [...plan.entries] } : null,
      planLocked,
    };
    set({
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, currentSnapshot],
      pool: snapshot.pool,
      plan: snapshot.plan,
      planLocked: snapshot.planLocked,
    });
    get().addToast('已回退到上一步', 'info');
  },
  redo: () => {
    const { redoStack, pool, plan, planLocked, undoStack } = get();
    if (redoStack.length === 0) {
      get().addToast('没有更晚的操作可重做', 'warning');
      return;
    }
    const snapshot = redoStack[redoStack.length - 1];
    const currentSnapshot: Snapshot = {
      pool: [...pool],
      plan: plan ? { ...plan, entries: [...plan.entries] } : null,
      planLocked,
    };
    set({
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, currentSnapshot],
      pool: snapshot.pool,
      plan: snapshot.plan,
      planLocked: snapshot.planLocked,
    });
    get().addToast('已重做到下一步', 'info');
  },

  // --- 设置 ---
  llmKey: '',
  preferences: { ...DEFAULT_PREFERENCES },
  setLLMKey: (key) => set({ llmKey: key }),
  setPreferences: (prefs) =>
    set((s) => ({ preferences: { ...s.preferences, ...prefs } })),

  // --- UI ---
  toasts: [],
  addToast: (text, type = 'info') => {
    const id = `toast-${++toastCounter}`;
    const toast: ToastMessage = { id, text, type };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismissToast(id), 3000);
  },
  dismissToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));
