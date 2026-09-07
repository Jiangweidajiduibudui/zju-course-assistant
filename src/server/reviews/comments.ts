import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { z } from "zod";
import { SummaryInput } from "../../shared/contracts/llm.js";
import type { Comment } from "../../shared/contracts/reviews.js";

export function plainReviewText(raw: string): string {
  const $ = load(raw, {}, false);
  $("script,style,iframe,object,svg,img").remove();
  $("br").replaceWith(" ");
  return $.root()
    .text()
    .normalize("NFKC")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function anonymousReviewText(raw: string): string {
  return plainReviewText(raw)
    .replace(/https?:\/\/\S+/gi, "[链接]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱]")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})\b/gi,
      "[凭据]",
    )
    .replace(/\b\d{8,18}\b/g, "[号码]")
    .trim();
}

export function prepareSummary(
  reviewId: string,
  comments: z.infer<typeof Comment>[],
) {
  const seen = new Set<string>();
  const untrustedComments: Array<{ id: string; text: string }> = [];
  let remaining = 50_000;
  for (const comment of comments) {
    const text = anonymousReviewText(comment.text).slice(
      0,
      Math.min(2000, remaining),
    );
    const fingerprint = createHash("sha256").update(text).digest("hex");
    if (!text || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    untrustedComments.push({
      id: `comment-${untrustedComments.length + 1}`,
      text,
    });
    remaining -= text.length;
    if (untrustedComments.length === 100 || remaining === 0) break;
  }
  if (!untrustedComments.length) return null;
  return SummaryInput.parse({
    subjectRef: reviewId,
    untrustedComments,
    lowSampleThreshold: 5,
  });
}
