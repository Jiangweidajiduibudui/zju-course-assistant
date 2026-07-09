import Dexie, { type EntityTable } from "dexie";
import type { Session } from "../../shared/contracts/index.js";

/**
 * Dexie/IndexedDB —— 用户持久状态的唯一事实源（D33；docs/04 §1）。
 *
 * 存储内容：session、教师映射表（D13）、用户端点配置、隐私同意标记。
 * 铁律：
 * - 服务端不保存这些数据（D04）；设置页必须提供全量清除（AC-11.3）；
 * - 每次结构变化递增版本并保留历史 upgrade 链，禁止覆盖已发布 Schema（docs/07 §4.5）；
 * - useLiveQuery 初始返回 undefined，UI 必须显式处理加载态。
 */

/** 教师映射（D13）：用户确认的 教学班教师 ↔ chalaoshi 教师 对应关系，可更正可删除 */
export interface TeacherMapping {
  /** `${teacherName}::${college}` */
  key: string;
  chalaoshiTeacherId: number;
  confirmedAt: string;
}

/** 通用键值（隐私同意标记、LLM 端点配置等；key 唯一） */
export interface KvEntry {
  key: string;
  value: unknown;
}

export const db = new Dexie("zju-course-assistant") as Dexie & {
  sessions: EntityTable<Session, "id">;
  teacherMappings: EntityTable<TeacherMapping, "key">;
  kv: EntityTable<KvEntry, "key">;
};

db.version(1).stores({
  sessions: "id, createdAt",
  teacherMappings: "key",
  kv: "key",
});

/** 一键清除全部客户端数据（AC-11.3；Task 5 接入设置页） */
export async function clearAllLocalData(): Promise<void> {
  await Promise.all([db.sessions.clear(), db.teacherMappings.clear(), db.kv.clear()]);
}
