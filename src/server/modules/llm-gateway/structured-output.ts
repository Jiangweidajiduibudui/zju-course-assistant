import type * as z from "zod";
import { type ErrorCode, ErrorCodes } from "../../../shared/contracts/errors.js";
import {
  type ExplainOutput,
  explainOutputSchema,
  type GroupRankingOutput,
  groupRankingOutputSchema,
  type PlanComparisonOutput,
  type PreferenceStructuringOutput,
  planComparisonOutputSchema,
  preferenceStructuringOutputSchema,
  type ReviewSummaryOutput,
  reviewSummaryOutputSchema,
} from "../../../shared/contracts/llm.js";

type StructuredTaskOutput = {
  preference: PreferenceStructuringOutput;
  "review-summary": ReviewSummaryOutput;
  "group-ranking": GroupRankingOutput;
  "plan-comparison": PlanComparisonOutput;
  explain: ExplainOutput;
};

export type StructuredTask = keyof StructuredTaskOutput;

export interface StructuredOutputContext {
  /** groupId -> 当前输入志愿组内允许 LLM 排序的教学班 ID */
  groupSectionIds?: Record<string, string[]>;
  /** 兼容低门槛调用：只校验 orderedSectionIds 是否在全局输入集合内 */
  allowedSectionIds?: string[];
  /** Top10 候选方案 ID 集合 */
  planIds?: string[];
}

export type StructuredOutputValidationResult =
  | { ok: true; output: StructuredTaskOutput[StructuredTask] }
  | {
      ok: false;
      errorCode: Extract<ErrorCode, "LLM_SCHEMA_INVALID" | "LLM_ID_OUT_OF_INPUT">;
      message: string;
      details?: unknown;
    };

const taskSchemas = {
  preference: preferenceStructuringOutputSchema,
  "review-summary": reviewSummaryOutputSchema,
  "group-ranking": groupRankingOutputSchema,
  "plan-comparison": planComparisonOutputSchema,
  explain: explainOutputSchema,
} satisfies Record<StructuredTask, z.ZodType>;

/**
 * LLM 原始输出的唯一入口：先 JSON/Zod schema，再做输入 ID 闭包校验。
 * 这里不做任何状态写入；planner/client 必须在后续 finalValidate 后才可应用结果。
 */
export function validateStructuredOutput(
  task: StructuredTask,
  rawOutput: unknown,
  context: StructuredOutputContext = {},
): StructuredOutputValidationResult {
  const json = parseMaybeJson(rawOutput);
  if (!json.ok) {
    return {
      ok: false,
      errorCode: ErrorCodes.LLM_SCHEMA_INVALID,
      message: "LLM 输出不是合法 JSON",
    };
  }

  const parsed = taskSchemas[task].safeParse(json.value);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: ErrorCodes.LLM_SCHEMA_INVALID,
      message: "LLM 输出不符合结构化 schema",
      details: parsed.error.issues,
    };
  }

  if (task === "group-ranking") {
    const idVerdict = validateGroupRankingIds(parsed.data as GroupRankingOutput, context);
    if (!idVerdict.ok) {
      return idVerdict;
    }
  }

  if (task === "plan-comparison") {
    const idVerdict = validatePlanComparisonIds(parsed.data as PlanComparisonOutput, context);
    if (!idVerdict.ok) {
      return idVerdict;
    }
  }

  return { ok: true, output: parsed.data as StructuredTaskOutput[StructuredTask] };
}

function parseMaybeJson(rawOutput: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof rawOutput !== "string") {
    return { ok: true, value: rawOutput };
  }

  try {
    return { ok: true, value: JSON.parse(rawOutput) };
  } catch {
    return { ok: false };
  }
}

function validateGroupRankingIds(
  output: GroupRankingOutput,
  context: StructuredOutputContext,
): StructuredOutputValidationResult {
  const groupSectionIds = context.groupSectionIds ?? {};
  const allowedSectionIds = new Set(
    context.allowedSectionIds ?? Object.values(groupSectionIds).flat(),
  );
  const hasGroupScope = Object.keys(groupSectionIds).length > 0;

  for (const ranking of output.groupRankings) {
    const groupAllowedIds = groupSectionIds[ranking.groupId];
    if (hasGroupScope && groupAllowedIds === undefined) {
      return idOutOfInput(`LLM 返回了输入集合外的 groupId：${ranking.groupId}`);
    }

    const allowedInThisRanking = new Set(groupAllowedIds ?? Array.from(allowedSectionIds));
    for (const sectionId of ranking.orderedSectionIds) {
      if (!allowedInThisRanking.has(sectionId)) {
        return idOutOfInput(`LLM 返回了输入集合外的 sectionId：${sectionId}`);
      }
    }
  }

  return { ok: true, output };
}

function validatePlanComparisonIds(
  output: PlanComparisonOutput,
  context: StructuredOutputContext,
): StructuredOutputValidationResult {
  const allowedPlanIds = new Set(context.planIds ?? []);
  if (allowedPlanIds.size === 0) {
    return idOutOfInput("缺少输入 Top10 planId 集合，无法校验 LLM 返回的方案 ID");
  }

  if (!allowedPlanIds.has(output.chosenPlanId)) {
    return idOutOfInput(`LLM 返回了输入集合外的 chosenPlanId：${output.chosenPlanId}`);
  }

  for (const planId of output.ranking) {
    if (!allowedPlanIds.has(planId)) {
      return idOutOfInput(`LLM 返回了输入集合外的 ranking planId：${planId}`);
    }
  }

  return { ok: true, output };
}

function idOutOfInput(message: string): StructuredOutputValidationResult {
  return {
    ok: false,
    errorCode: ErrorCodes.LLM_ID_OUT_OF_INPUT,
    message,
  };
}
