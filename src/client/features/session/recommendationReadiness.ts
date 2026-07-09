import type { Session } from "../../../shared/contracts/index.js";
import { countSessionPoolSections } from "./sessionSummary.js";

export type RecommendationReadinessState = "ready" | "missing" | "blocked";

export interface RecommendationReadinessItem {
  id: "session" | "creditLimit" | "pool" | "llmConfig" | "selectionModel";
  label: string;
  state: RecommendationReadinessState;
  detail: string;
}

export interface RecommendationReadiness {
  items: RecommendationReadinessItem[];
  userPrerequisitesMet: boolean;
  canGenerateRecommendation: boolean;
  summary: string;
}

function countMissingUserPrerequisites(items: RecommendationReadinessItem[]): number {
  return items.filter((item) => item.state === "missing").length;
}

export function getRecommendationReadiness(session: Session | null): RecommendationReadiness {
  const poolSectionCount = session ? countSessionPoolSections(session) : 0;
  const items: RecommendationReadinessItem[] = [
    session
      ? {
          id: "session",
          label: "Session 已创建",
          state: "ready",
          detail: session.name,
        }
      : {
          id: "session",
          label: "Session",
          state: "missing",
          detail: "请先加载课程数据并创建 session",
        },
    session?.rules.creditLimit
      ? {
          id: "creditLimit",
          label: "学分上限已填写",
          state: "ready",
          detail: `${session.rules.creditLimit} 学分`,
        }
      : {
          id: "creditLimit",
          label: "学分上限",
          state: "missing",
          detail: "请先在设置页填写学分上限",
        },
    session && session.pool.targets.length > 0 && poolSectionCount > 0
      ? {
          id: "pool",
          label: "待选池已准备",
          state: "ready",
          detail: `${session.pool.targets.length} 门课程 / ${poolSectionCount} 个候选教学班`,
        }
      : {
          id: "pool",
          label: "待选池",
          state: "missing",
          detail: "请先加入至少一门课程和一个候选教学班",
        },
    {
      id: "llmConfig",
      label: "LLM/key 配置",
      state: "blocked",
      detail: "尚未配置 LLM key 或完成能力检测；当前不会调用后端生成推荐",
    },
    {
      id: "selectionModel",
      label: "selection-model/planner 接入",
      state: "blocked",
      detail: "等待 Task 1/Task 6 接入后才能真正生成推荐",
    },
  ];

  const missingCount = countMissingUserPrerequisites(items);
  const userPrerequisitesMet = missingCount === 0;

  return {
    items,
    userPrerequisitesMet,
    canGenerateRecommendation: false,
    summary: userPrerequisitesMet
      ? "用户前置已完成；生成推荐暂不可用：LLM/key 未配置，且等待 selection-model 接入"
      : `还缺 ${missingCount} 项用户前置：${items
          .filter((item) => item.state === "missing")
          .map((item) => item.label)
          .join("、")}`,
  };
}
