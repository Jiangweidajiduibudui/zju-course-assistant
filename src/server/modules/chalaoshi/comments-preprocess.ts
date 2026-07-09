import type { Comment } from "../../../shared/contracts/index.js";

/**
 * 评论预处理（D12；docs/05 §4）：近五年筛选、去重、长度限制。
 * 在 service 层对 live/seed 评论统一执行，便于注入 now 做确定性测试。
 */

const FIVE_YEARS_MS = 5 * 365.25 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TEXT_LENGTH = 2000;

export interface PreprocessCommentsOptions {
  now?: Date;
  maxTextLength?: number;
}

function toDateOnly(isoDate: string): string {
  return isoDate.slice(0, 10);
}

function cutoffDateOnly(now: Date): string {
  return toDateOnly(new Date(now.getTime() - FIVE_YEARS_MS).toISOString());
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

/**
 * 近五年筛选 → 按规范化文本去重（保留较新 postedAt）→ 限长。
 * 不改变相对时间序：结果按 postedAt 降序。
 */
export function preprocessComments(
  comments: Comment[],
  options: PreprocessCommentsOptions = {},
): Comment[] {
  const now = options.now ?? new Date();
  const maxTextLength = options.maxTextLength ?? DEFAULT_MAX_TEXT_LENGTH;
  const cutoff = cutoffDateOnly(now);

  const recent = comments.filter((c) => c.postedAt >= cutoff);

  const byText = new Map<string, Comment>();
  for (const comment of recent) {
    const key = normalizeText(comment.text);
    if (!key) continue;
    const existing = byText.get(key);
    if (!existing || comment.postedAt > existing.postedAt) {
      byText.set(key, {
        ...comment,
        text: truncateText(normalizeText(comment.text), maxTextLength),
      });
    }
  }

  return [...byText.values()].sort((a, b) => b.postedAt.localeCompare(a.postedAt));
}
