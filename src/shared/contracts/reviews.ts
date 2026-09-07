import { z } from "zod";
import { Teacher } from "./catalog.js";
import {
  ApiError,
  Count,
  field,
  HttpsUrl,
  Id,
  Revision,
  Source,
  Text,
  Timestamp,
  unique,
} from "./common.js";

export const Metric = z
  .strictObject({
    value: z.number(),
    minimum: z.number(),
    maximum: z.number(),
    sampleSize: field(Count),
  })
  .refine(
    (metric) =>
      metric.minimum < metric.maximum &&
      metric.value >= metric.minimum &&
      metric.value <= metric.maximum,
    "Metric outside its declared scale",
  );
export const ExternalTeacher = z.strictObject({
  id: Id,
  name: Text,
  college: field(Text),
  source: Source,
});
export const TeacherMatchState = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unmatched"), reason: Text }),
  z.strictObject({
    status: z.literal("needs_confirmation"),
    candidates: z.array(ExternalTeacher).min(1).max(100),
  }),
  z.strictObject({
    status: z.literal("matched"),
    teacher: ExternalTeacher,
    method: z.enum(["exact_name_college", "user_confirmed"]),
  }),
]);
export const TeacherMatch = z
  .strictObject({
    id: Id,
    revision: Revision,
    officialTeacher: Teacher,
    snapshotId: Id,
    sourceId: z.enum(["primary", "fallback"]),
    sourceBaseUrl: HttpsUrl,
    state: TeacherMatchState,
  })
  .superRefine((match, ctx) => {
    if (
      match.state.status !== "matched" ||
      match.state.method !== "exact_name_college"
    )
      return;
    const normalize = (text: string) =>
      text.normalize("NFKC").trim().replace(/\s+/g, " ");
    const official = match.officialTeacher;
    const external = match.state.teacher;
    if (
      official.college.state !== "known" ||
      external.college.state !== "known" ||
      normalize(official.college.value) !== normalize(external.college.value) ||
      normalize(official.name) !== normalize(external.name)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Automatic teacher matching requires equal known names and colleges",
      });
  });
export const CourseGradeMatch = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unmatched"), reason: Text }),
  z.strictObject({
    status: z.literal("matched"),
    externalCourseId: Id,
    method: z.enum(["unique_normalized_name", "user_confirmed"]),
  }),
]);
export const Review = z
  .strictObject({
    id: Id,
    revision: Revision,
    courseId: Id,
    matchId: Id,
    matchRevision: Revision,
    sourceId: z.enum(["primary", "fallback"]),
    source: Source,
    fetchedAt: Timestamp,
    synthetic: z.boolean(),
    cacheState: z.enum(["fresh", "stale"]),
    lastFetchError: ApiError.nullable(),
    teacherRating: field(Metric),
    courseGrades: z
      .array(z.strictObject({ id: Id, label: Text, average: field(Metric) }))
      .max(1000),
    courseGradeMatch: CourseGradeMatch,
    availableCommentCount: field(Count),
  })
  .superRefine((review, ctx) => {
    if (!unique(review.courseGrades.map((course) => course.id)))
      ctx.addIssue({
        code: "custom",
        message: "Duplicate external course IDs",
      });
    const match = review.courseGradeMatch;
    if (
      match.status === "matched" &&
      !review.courseGrades.some(
        (course) => course.id === match.externalCourseId,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Matched GPA must belong to this review's course grades",
      });
  });
export const Comment = z.strictObject({
  id: Id,
  text: z.string().min(1).max(10000),
  postedAt: field(Timestamp),
});
export const ReviewFetchResult = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("available"), review: Review }),
  z.strictObject({ status: z.literal("empty"), source: Source }),
  z.strictObject({
    status: z.literal("source_switch_required"),
    failedSourceId: z.enum(["primary", "fallback"]),
    suggestedSourceId: z.enum(["primary", "fallback"]),
    cause: ApiError,
    cachedReview: Review.nullable(),
  }),
]);
