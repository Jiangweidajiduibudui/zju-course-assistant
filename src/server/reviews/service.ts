import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "../../shared/contracts/api.js";
import type { SnapshotData, Teacher } from "../../shared/contracts/catalog.js";
import {
  PlanningReviewEvidence,
  SummaryRecord,
} from "../../shared/contracts/llm.js";
import type { Settings } from "../../shared/contracts/operations.js";
import {
  Comment,
  ExternalTeacher,
  Review,
  type ReviewFetchResult,
  TeacherMatch,
} from "../../shared/contracts/reviews.js";
import { fail, ServiceError } from "../errors.js";
import type { Store } from "../storage/store.js";
import { LiveReviews, type ReviewDriver } from "./source.js";
import { reviewUrl } from "./transport.js";

type SourceId = "primary" | "fallback";
type Match = z.infer<typeof TeacherMatch>;
const now = () => new Date().toISOString();
const normalize = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ");
const CACHE_MS = 24 * 60 * 60 * 1000;

export class ReviewService {
  private readonly indexes = new Map<
    string,
    { at: number; teachers: z.infer<typeof ExternalTeacher>[] }
  >();
  private readonly indexing = new Map<
    string,
    Promise<z.infer<typeof ExternalTeacher>[]>
  >();
  private readonly fetching = new Map<
    string,
    Promise<z.infer<typeof ReviewFetchResult>>
  >();
  private readonly controllers = new Set<AbortController>();
  private epoch = 0;
  constructor(
    private store: Store,
    private settings: () => z.infer<typeof Settings>,
    private driver: ReviewDriver = new LiveReviews(),
  ) {}

  private source(sourceId: SourceId) {
    const settings = this.settings();
    if (!settings.content.reviewsEnabled)
      return fail("EXTERNAL_ACCESS_DISABLED", "请先启用外部评价。");
    return reviewUrl(settings.content.reviewSources[sourceId]).href;
  }
  planningEvidence(snapshot: SnapshotData, sectionIds: string[]) {
    const settings = this.settings().content;
    if (!settings.reviewsEnabled) return [];
    const matches = this.store.resources("teacher-match", TeacherMatch);
    const summaries = this.store.resources("summary", SummaryRecord);
    return this.store.resources("review", Review).flatMap((review) => {
      const match = matches.find((m) => m.id === review.matchId);
      if (
        !match ||
        match.revision !== review.matchRevision ||
        match.snapshotId !== snapshot.meta.id ||
        match.state.status !== "matched" ||
        match.sourceBaseUrl !==
          reviewUrl(settings.reviewSources[match.sourceId]).href ||
        review.sourceId !== match.sourceId ||
        review.cacheState !== "fresh" ||
        Date.now() - Date.parse(review.fetchedAt) >= CACHE_MS ||
        review.synthetic !== snapshot.meta.provenance.synthetic
      )
        return [];
      const gradeMatch = review.courseGradeMatch;
      const courseGrade =
        gradeMatch.status === "matched"
          ? review.courseGrades.find(
              (g) => g.id === gradeMatch.externalCourseId,
            )?.average
          : undefined;
      const summary =
        summaries
          .filter(
            (s) =>
              s.reviewId === review.id &&
              s.reviewRevision === review.revision &&
              settings.endpoints.some(
                (e) =>
                  e.id === s.endpointId && e.revision === s.endpointRevision,
              ),
          )
          .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0]
          ?.output ?? null;
      if (
        review.teacherRating.state !== "known" &&
        !(
          review.teacherRating.state === "unknown" &&
          review.teacherRating.displayText
        ) &&
        courseGrade?.state !== "known" &&
        !(courseGrade?.state === "unknown" && courseGrade.displayText) &&
        !summary
      )
        return [];
      return snapshot.sections
        .filter(
          (s) =>
            sectionIds.includes(s.id) &&
            s.courseId === review.courseId &&
            s.teachers.state === "known" &&
            s.teachers.value.some((t) => t.id === match.officialTeacher.id),
        )
        .map((section) =>
          PlanningReviewEvidence.parse({
            sectionId: section.id,
            courseId: section.courseId,
            reviewId: review.id,
            reviewRevision: review.revision,
            source: review.source,
            synthetic: review.synthetic,
            teacherRating: review.teacherRating,
            courseGrade: courseGrade ?? {
              state: "unknown",
              reason: "not_verified",
            },
            summary,
          }),
        );
    });
  }
  private current(sourceId: SourceId, base: string, epoch: number) {
    if (epoch !== this.epoch || this.source(sourceId) !== base)
      fail("REVISION_CONFLICT", "评价来源或本机数据已变化，请重新加载。");
  }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.controllers.delete(controller);
    }
  }
  private index(base: string) {
    const cached = this.indexes.get(base);
    if (cached && Date.now() - cached.at < CACHE_MS)
      return Promise.resolve(cached.teachers);
    const active = this.indexing.get(base);
    if (active) return active;
    const epoch = this.epoch;
    const work = this.bounded((signal) => this.driver.index(base, signal))
      .then((teachers) => {
        const rows = z.array(ExternalTeacher).max(50_000).parse(teachers);
        if (epoch !== this.epoch) return rows;
        if (this.indexes.size >= 4) this.indexes.clear();
        this.indexes.set(base, { at: Date.now(), teachers: rows });
        return rows;
      })
      .finally(() => this.indexing.delete(base));
    this.indexing.set(base, work);
    return work;
  }
  async lookup(raw: unknown) {
    const input = api.lookupReviewMatch.body.parse(raw);
    const base = this.source(input.sourceId),
      epoch = this.epoch;
    const snapshot = this.store.snapshot(input.snapshotId);
    if (snapshot.meta.provenance.synthetic && !this.driver.synthetic)
      return fail("VALIDATION_FAILED", "合成教学班不查询真实教师评价。");
    const teacher = snapshot.sections
      .flatMap((s) => (s.teachers.state === "known" ? s.teachers.value : []))
      .find((t) => t.id === input.teacherId);
    if (!teacher) return fail("NOT_FOUND", "当前课程数据中没有这位教师。");
    const existing = this.store
      .resources("teacher-match", TeacherMatch)
      .find(
        (m) =>
          m.snapshotId === input.snapshotId &&
          m.officialTeacher.id === teacher.id &&
          m.sourceId === input.sourceId &&
          m.sourceBaseUrl === base,
      );
    if (existing?.state.status === "matched") return existing;
    const candidates = (await this.index(base)).filter(
      (t) => normalize(t.name) === normalize(teacher.name),
    );
    this.current(input.sourceId, base, epoch);
    this.store.snapshot(input.snapshotId);
    if (candidates.length > 100)
      return fail("UPSTREAM_SCHEMA_CHANGED", "同名教师过多，暂无法可靠匹配。");
    const exact = candidates.filter((t) => sameCollege(teacher, t));
    const state: Match["state"] =
      candidates.length === 0
        ? { status: "unmatched", reason: "暂未找到同名教师评价。" }
        : exact.length === 1 && exact[0]
          ? {
              status: "matched",
              teacher: exact[0],
              method: "exact_name_college",
            }
          : { status: "needs_confirmation", candidates };
    return this.store.transaction(() => {
      const latest = existing
        ? this.store.get("teacher-match", existing.id, TeacherMatch)
        : this.store
            .resources("teacher-match", TeacherMatch)
            .find(
              (item) =>
                item.snapshotId === input.snapshotId &&
                item.officialTeacher.id === teacher.id &&
                item.sourceId === input.sourceId &&
                item.sourceBaseUrl === base,
            );
      if (latest && latest.revision !== existing?.revision) return latest;
      const match = TeacherMatch.parse({
        id: existing?.id ?? `match-${randomUUID()}`,
        revision: (existing?.revision ?? 0) + 1,
        officialTeacher: teacher,
        snapshotId: input.snapshotId,
        sourceId: input.sourceId,
        sourceBaseUrl: base,
        state,
      });
      this.store.put("teacher-match", match.id, match);
      return match;
    });
  }
  confirm(matchId: string, raw: unknown) {
    const input = api.confirmReviewMatch.body.parse(raw);
    const match = this.match(matchId, input.expectedRevision);
    this.sourceForMatch(match);
    if (match.state.status !== "needs_confirmation")
      return fail("VALIDATION_FAILED", "这次教师匹配不需要确认。");
    const teacher = match.state.candidates.find(
      (t) => t.id === input.externalTeacherId,
    );
    if (!teacher) return fail("VALIDATION_FAILED", "只能选择当前列出的教师。");
    const next = TeacherMatch.parse({
      ...match,
      revision: match.revision + 1,
      state: { status: "matched", teacher, method: "user_confirmed" },
    });
    this.store.put("teacher-match", matchId, next);
    return next;
  }
  private match(id: string, revision?: number) {
    const match = this.store.get("teacher-match", id, TeacherMatch);
    if (!match) return fail("NOT_FOUND", "教师匹配已失效，请重新加载。");
    if (revision !== undefined && match.revision !== revision)
      return fail("REVISION_CONFLICT", "教师匹配已变化，请重新加载。");
    return match;
  }
  private sourceForMatch(match: Match) {
    const base = this.source(match.sourceId);
    if (match.sourceBaseUrl !== base)
      return fail("REVISION_CONFLICT", "评价来源已改变，请重新匹配教师。");
    return base;
  }
  fetch(raw: unknown) {
    const input = api.fetchReview.body.parse(raw);
    const fingerprint = JSON.stringify(input);
    const active = this.fetching.get(fingerprint);
    if (active) return active;
    const work = this.fetchOne(input).finally(() =>
      this.fetching.delete(fingerprint),
    );
    this.fetching.set(fingerprint, work);
    return work;
  }
  private async fetchOne(
    input: z.infer<typeof api.fetchReview.body>,
  ): Promise<z.infer<typeof ReviewFetchResult>> {
    const match = this.match(input.matchId, input.matchRevision);
    if (
      match.sourceId !== input.sourceId ||
      match.snapshotId !== input.snapshotId
    )
      return fail(
        "VALIDATION_FAILED",
        "评价请求与教师匹配的来源或课程数据不一致。",
      );
    const base = this.sourceForMatch(match),
      epoch = this.epoch;
    if (match.state.status !== "matched")
      return fail("MATCH_CONFIRMATION_REQUIRED", "请先确认教师身份。");
    const snapshot = this.store.snapshot(input.snapshotId);
    const course = snapshot.courses.find((c) => c.id === input.courseId);
    if (
      !course ||
      !snapshot.sections.some(
        (s) =>
          s.courseId === course.id &&
          s.teachers.state === "known" &&
          s.teachers.value.some((t) => t.id === match.officialTeacher.id),
      )
    )
      return fail("VALIDATION_FAILED", "这位教师不属于所选课程。");
    const cached = this.store
      .resources("review", Review)
      .find(
        (r) =>
          r.courseId === course.id &&
          r.matchId === match.id &&
          r.matchRevision === match.revision &&
          r.sourceId === match.sourceId,
      );
    if (
      !input.refresh &&
      cached &&
      cached.cacheState === "fresh" &&
      Date.now() - Date.parse(cached.fetchedAt) < CACHE_MS
    )
      return { status: "available", review: cached };
    try {
      const teacher = match.state.teacher;
      const content = await this.bounded((signal) =>
        this.driver.review(base, teacher, signal),
      );
      this.current(input.sourceId, base, epoch);
      this.match(match.id, match.revision);
      this.store.snapshot(input.snapshotId);
      const grades = content.courseGrades.filter(
        (g) => normalize(g.label) === normalize(course.title),
      );
      const previousMatch = cached?.courseGradeMatch;
      const courseGradeMatch =
        previousMatch?.status === "matched" &&
        previousMatch.method === "user_confirmed" &&
        content.courseGrades.some(
          (g) => g.id === previousMatch.externalCourseId,
        )
          ? previousMatch
          : grades.length === 1 && grades[0]
            ? {
                status: "matched" as const,
                externalCourseId: grades[0].id,
                method: "unique_normalized_name" as const,
              }
            : {
                status: "unmatched" as const,
                reason: "暂无本课程的可靠均绩匹配。",
              };
      return this.store.transaction(() => {
        const current = this.store
          .resources("review", Review)
          .find(
            (r) =>
              r.courseId === course.id &&
              r.matchId === match.id &&
              r.matchRevision === match.revision &&
              r.sourceId === match.sourceId,
          );
        if ((current?.revision ?? 0) !== (cached?.revision ?? 0))
          return fail("REVISION_CONFLICT", "评价已被更新，请重新加载。");
        const { comments, ...metadata } = content;
        const review = Review.parse({
          ...metadata,
          id: cached?.id ?? `review-${randomUUID()}`,
          revision: (cached?.revision ?? 0) + 1,
          courseId: course.id,
          matchId: match.id,
          matchRevision: match.revision,
          sourceId: match.sourceId,
          fetchedAt: now(),
          synthetic: this.driver.synthetic,
          cacheState: "fresh",
          lastFetchError: null,
          courseGradeMatch,
        });
        this.store.put("review", review.id, review);
        this.store.put(
          "comments",
          review.id,
          z.array(Comment).max(10000).parse(comments),
        );
        return { status: "available" as const, review };
      });
    } catch (error) {
      if (
        !(error instanceof ServiceError) ||
        ![
          "UPSTREAM_UNAVAILABLE",
          "UPSTREAM_SCHEMA_CHANGED",
          "ENDPOINT_REJECTED",
        ].includes(error.code)
      )
        throw error;
      this.current(input.sourceId, base, epoch);
      this.match(match.id, match.revision);
      this.store.snapshot(input.snapshotId);
      if (
        cached &&
        this.store.get("review", cached.id, Review)?.revision !==
          cached.revision
      )
        return fail("REVISION_CONFLICT", "评价已更新，请重新加载。");
      const cause = {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        fields: [],
      };
      const stale = cached
        ? Review.parse({
            ...cached,
            cacheState: "stale",
            lastFetchError: cause,
          })
        : null;
      if (stale) this.store.put("review", stale.id, stale);
      return {
        status: "source_switch_required",
        failedSourceId: input.sourceId,
        suggestedSourceId:
          input.sourceId === "primary" ? "fallback" : "primary",
        cause,
        cachedReview: stale,
      };
    }
  }
  get(id: string) {
    const review = this.store.get("review", id, Review);
    if (!review) return fail("NOT_FOUND", "评价尚未加载。");
    this.sourceForMatch(this.match(review.matchId, review.matchRevision));
    return review;
  }
  comments(id: string, revision: number) {
    const review = this.get(id);
    if (review.revision !== revision)
      return fail("REVISION_CONFLICT", "评价已更新，请重新加载评论。");
    return {
      review,
      items: this.store.get("comments", id, z.array(Comment).max(10000)) ?? [],
    };
  }
  confirmCourse(id: string, raw: unknown) {
    const input = api.confirmCourseGrade.body.parse(raw),
      review = this.get(id);
    if (review.revision !== input.expectedRevision)
      return fail("REVISION_CONFLICT", "评价已更新，请重新加载。");
    if (!review.courseGrades.some((c) => c.id === input.externalCourseId))
      return fail("VALIDATION_FAILED", "只能选择当前教师评价列出的课程。");
    const next = Review.parse({
      ...review,
      revision: review.revision + 1,
      courseGradeMatch: {
        status: "matched",
        externalCourseId: input.externalCourseId,
        method: "user_confirmed",
      },
    });
    this.store.put("review", id, next);
    return next;
  }
  clear() {
    this.epoch++;
    for (const controller of this.controllers) controller.abort();
    this.indexes.clear();
  }
}
function sameCollege(
  a: z.infer<typeof Teacher>,
  b: z.infer<typeof ExternalTeacher>,
) {
  return (
    a.college.state === "known" &&
    b.college.state === "known" &&
    normalize(a.college.value) === normalize(b.college.value)
  );
}
