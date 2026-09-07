import { createHash } from "node:crypto";
import { z } from "zod";
import {
  Course,
  Exam,
  Meeting,
  Section,
  Snapshot,
  type SnapshotData,
  Term,
} from "../../shared/contracts/catalog.js";
import { fail } from "../errors.js";
import { READ_PATHS, SCHOOL_ORIGIN } from "./allowlist.js";
import type { PageContext } from "./session.js";

const rawText = z.string().max(10000);
export const CourseRow = z.object({
  rn: z.string().regex(/^\d+$/),
  kcdm: rawText.min(1),
  kcmc: rawText.min(1),
  xkkh: rawText.min(1),
  xskcdm: rawText.optional(),
  kcxx: rawText.optional(),
  kclb: rawText.optional(),
  kkxy: rawText.optional(),
  xxq: rawText.optional(),
});
export const SectionRow = z.object({
  kcdm: rawText.optional(),
  xskcdm: rawText.optional(),
  xkkh: rawText.min(1),
  jsxm: rawText.optional(),
  jszgh: rawText.optional(),
  xxq: rawText.optional(),
  vxxq: rawText.optional(),
  sksj: rawText.optional(),
  vsksj: rawText.optional(),
  skdd: rawText.optional(),
  kssj: rawText.optional(),
  vkssj: rawText.optional(),
  zxs: rawText.optional(),
  skxs: rawText.optional(),
  mxdx: rawText.optional(),
  gjhkc: rawText.optional(),
  jxfs: rawText.optional(),
  rs: rawText.optional(),
  brl: rawText.optional(),
  grl: rawText.optional(),
  yxrs: rawText.optional(),
  sfxz: rawText.optional(),
});
export const ChosenRow = SectionRow.extend({
  kcdm: rawText.min(1),
  kcmc: rawText.min(1),
  xskcdm: rawText.optional(),
  xf: rawText.optional(),
  sxbj: rawText.optional(),
  xkzy: z.number().int().optional(),
  xkzyfz: rawText.optional(),
  vxkzyfz: rawText.optional(),
});
export const WeekRows = z.object({
  status: z.literal("success"),
  result: z
    .array(
      z.object({
        xxq: rawText.min(1),
        zc: z.number().int().min(1).max(60),
        dxqzc: z.number().int().min(1).max(60),
      }),
    )
    .max(720),
});
export type RawCourse = z.infer<typeof CourseRow>;
export type RawSection = z.infer<typeof SectionRow>;
export type RawChosen = z.infer<typeof ChosenRow>;
export type Weeks = z.infer<typeof WeekRows>["result"];
export const opaque = (kind: string, ...values: string[]) =>
  `${kind}-${createHash("sha256").update(JSON.stringify(values)).digest("hex").slice(0, 32)}`;
export const known = <T>(value: T) => ({ state: "known" as const, value });
export function unknown(
  raw?: string,
  reason: "not_provided" | "not_parsed" | "not_verified" = "not_provided",
) {
  return {
    state: "unknown" as const,
    reason,
    ...(raw?.trim() ? { displayText: plain(raw).slice(0, 2000) } : {}),
  };
}
export function plain(raw: string) {
  return raw
    .replace(/<br\s*\/?>/gi, ";")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}
const text = (raw?: string) =>
  raw && plain(raw) && !["undefined", "null"].includes(plain(raw))
    ? known(plain(raw).slice(0, 2000))
    : unknown();
function number(raw?: string, integer = false) {
  if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw.trim()))
    return unknown(raw, raw ? "not_parsed" : "not_provided");
  const n = Number(raw);
  return Number.isFinite(n) && (!integer || Number.isInteger(n))
    ? known(n)
    : unknown(raw, "not_parsed");
}
export const termId = (context: PageContext) =>
  opaque("term", context.year, context.code);
export function normalizeTerm(context: PageContext, weeks: Weeks = []) {
  return Term.parse({
    id: termId(context),
    label: `${context.year} · ${context.parts.filter((p) => weeks.some((w) => w.xxq === p)).join("") || context.parts.join("/")}`,
    academicYearStart: Number(context.year.slice(0, 4)),
    upstreamCode: context.code,
    timezone: "Asia/Shanghai",
    parts: context.parts.map((label) => ({
      id: opaque("part", context.year, context.code, label),
      label,
      weekOneMonday: unknown(undefined, "not_verified"),
      semesterWeeks: weeks.some((w) => w.xxq === label)
        ? known(
            weeks
              .filter((w) => w.xxq === label)
              .map((w) => ({ partWeek: w.zc, semesterWeek: w.dxqzc })),
          )
        : unknown(undefined, "not_verified"),
    })),
  });
}
export function normalizeCourse(row: RawCourse, term: z.infer<typeof Term>) {
  const values = row.kcxx?.split("~") ?? [];
  return Course.parse({
    id: opaque("course", term.id, row.kcdm),
    termId: term.id,
    code: plain(row.xskcdm || row.kcdm),
    title: plain(row.kcmc),
    credits: number(values[1]),
    category: row.kclb
      ? known({ code: plain(row.kclb), label: plain(row.kclb) })
      : unknown(),
    college: text(row.kkxy),
    hasPrerequisite:
      values[0] === "0"
        ? known(false)
        : values[0] === "1"
          ? known(true)
          : unknown(),
  });
}
export function normalizeExam(raw?: string) {
  if (!raw || ["-", "待定", "undefined"].includes(raw.trim()))
    return unknown(raw);
  const parsed: z.infer<typeof Exam>[] = [];
  for (const entry of plain(raw).split(/[;；]/).filter(Boolean)) {
    const m = entry
      .trim()
      .match(
        /^(\d{4})年(\d{1,2})月(\d{1,2})日\s*[(（](\d{1,2}):(\d{2})\s*[-~—]\s*(\d{1,2}):(\d{2})[)）]$/,
      );
    if (!m) return unknown(raw, "not_parsed");
    const date = `${m[1]}-${m[2]?.padStart(2, "0")}-${m[3]?.padStart(2, "0")}`;
    const start = `${date}T${m[4]?.padStart(2, "0")}:${m[5]}:00+08:00`,
      end = `${date}T${m[6]?.padStart(2, "0")}:${m[7]}:00+08:00`;
    const value = Exam.safeParse({
      startsAt: start,
      endsAt: end,
      location: unknown(),
    });
    if (!value.success) return unknown(raw, "not_parsed");
    parsed.push(value.data);
  }
  return parsed.length ? known(parsed) : unknown(raw);
}
function ranges(raw: string, maximum: number): number[] | null {
  const numbers: number[] = [];
  for (const item of raw.replace(/，/g, ",").split(",")) {
    const m = item.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const from = Number(m[1]),
      to = Number(m[2] ?? m[1]);
    if (from < 1 || to > maximum || from > to) return null;
    for (let i = from; i <= to; i++) numbers.push(i);
  }
  return [...new Set(numbers)].sort((a, b) => a - b);
}
export function normalizeMeetings(
  raw: string | undefined,
  parts: z.infer<typeof Term>["parts"],
  location?: string,
) {
  if (!raw || ["-", "待定", "undefined"].includes(raw.trim()))
    return unknown(raw);
  const meetings: z.infer<typeof Meeting>[] = [];
  // The school's current script uses weeks 1..8 when an occurrence has no explicit week clause.
  const entries = plain(raw)
    .replace(/；/g, ";")
    .split(/;(?=(?:周|星期))/)
    .filter(Boolean);
  for (const entry of entries) {
    const match = entry
      .trim()
      .match(/^(?:周|星期)([一二三四五六日天七])第([\d,，-]+)节(.*)$/);
    if (!match) return unknown(raw, "not_parsed");
    const periods = ranges(match[2] ?? "", 13);
    if (!periods?.length) return unknown(raw, "not_parsed");
    const suffix = match[3] ?? "";
    const clauses = [...suffix.matchAll(/([春夏秋冬短暑]+)([\d,，-]+)周/g)];
    if (suffix && !clauses.length && !/^[\s()（）单双周]*$/.test(suffix))
      return unknown(raw, "not_parsed");
    for (const part of parts) {
      let weeks: number[] | null = Array.from({ length: 8 }, (_, i) => i + 1);
      if (clauses.length) {
        const selected = clauses.filter((m) => m[1]?.includes(part.label));
        if (!selected.length) continue;
        weeks = [];
        for (const clause of selected) {
          const parsed = ranges(clause[2] ?? "", 60);
          if (!parsed) return unknown(raw, "not_parsed");
          weeks.push(...parsed);
        }
        weeks = [...new Set(weeks)];
      }
      if (suffix.includes("单")) weeks = weeks.filter((w) => w % 2 === 1);
      if (suffix.includes("双")) weeks = weeks.filter((w) => w % 2 === 0);
      if (!weeks.length) return unknown(raw, "not_parsed");
      let start = periods[0] ?? 1,
        end = start;
      const add = () =>
        meetings.push(
          Meeting.parse({
            slot: {
              partId: part.id,
              weeks,
              weekday:
                "一二三四五六日天七".indexOf(match[1] ?? "") >= 6
                  ? 7
                  : "一二三四五六".indexOf(match[1] ?? "") + 1,
              startPeriod: start,
              endPeriod: end,
            },
            location: text(location),
          }),
        );
      for (const period of periods.slice(1)) {
        if (period === end + 1) end = period;
        else {
          add();
          start = period;
          end = period;
        }
      }
      add();
    }
  }
  return meetings.length ? known(meetings) : unknown(raw, "not_parsed");
}
const quota = (raw?: string) => {
  const split = raw?.split("/");
  return {
    remaining: number(split?.[0], true),
    capacity: number(split?.[1], true),
  };
};
export function officialCapacity(
  raw?: string,
): "available" | "unavailable" | "unknown" {
  const remaining = raw?.split("/")[0]?.trim();
  if (!remaining || !/^-?\d+$/.test(remaining)) return "unknown";
  return Number(remaining) > 0 ? "available" : "unavailable";
}
export function normalizeSection(
  row: RawSection,
  courseId: string,
  term: z.infer<typeof Term>,
  listed = true,
) {
  const labels = row.vxxq || row.xxq || "",
    parts = term.parts.filter((p) => labels.includes(p.label));
  const names = plain(row.jsxm ?? "")
      .split(/[,，;；]/)
      .filter(Boolean),
    codes = (row.jszgh ?? "").split(/[,，;；]/).filter(Boolean);
  const teachers =
    names.length && names.length === codes.length
      ? known(
          names.map((name, i) => ({
            id: opaque("teacher", codes[i] ?? "", name),
            name,
            college: unknown(),
          })),
        )
      : unknown(row.jsxm, "not_parsed");
  const counts = row.yxrs?.split("~");
  return Section.parse({
    id: opaque("section", term.id, row.xkkh),
    courseId,
    termId: term.id,
    selectionCode: text(row.xkkh),
    listedInCatalog: listed,
    teachers,
    partIds: parts.map((p) => p.id),
    meetings: normalizeMeetings(row.vsksj || row.sksj, parts, row.skdd),
    exams: normalizeExam(row.vkssj || row.kssj),
    weeklyHours: number(row.zxs),
    campus: unknown(),
    deliveryMode: text(row.skxs),
    targetAudience: text(row.mxdx),
    internationalization: text(row.gjhkc),
    teachingMethod: text(row.jxfs),
    quotas: {
      overall: quota(row.rs),
      male: quota(row.brl),
      female: quota(row.grl),
    },
    pending: {
      major: number(counts?.[0], true),
      all: number(counts?.[1], true),
    },
    officialState: officialCapacity(row.rs),
    officialTimeConflict: unknown(undefined, "not_verified"),
    officialStateLabel:
      officialCapacity(row.rs) === "unknown"
        ? unknown(undefined, "not_verified")
        : known(
            officialCapacity(row.rs) === "available"
              ? "学校余量状态：可选（资格仍需学校校验）"
              : "学校余量状态：不可选",
          ),
    volunteerTimeGroupIds: unknown(undefined, "not_verified"),
  });
}
export function assemble(
  context: PageContext,
  weeks: Weeks,
  rows: RawCourse[],
  details: Map<string, RawSection[]>,
  chosen: RawChosen[],
  capturedAt: string,
): SnapshotData {
  const term = normalizeTerm(context, weeks),
    courses = new Map<string, z.infer<typeof Course>>(),
    sections = new Map<string, z.infer<typeof Section>>();
  const aliases = new Map<string, string>();
  const courseSections = new Map<string, z.infer<typeof Section>[]>();
  const courseSignature = (value: z.infer<typeof Course>) => {
    const { id: _id, ...metadata } = value;
    return JSON.stringify(metadata);
  };
  const sectionSignature = (values: z.infer<typeof Section>[]) =>
    JSON.stringify(
      values
        .map(({ courseId: _courseId, ...metadata }) => metadata)
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  // Some directory selectors alias the same concrete course. Only collapse an
  // alias when its nonempty official display code, every normalized course field,
  // and shared concrete sections agree, with one complete set contained in the
  // other. Non-nested overlap or conflicting metadata remains an error.
  for (const row of [...rows].sort((a, b) => a.kcdm.localeCompare(b.kcdm))) {
    const course = normalizeCourse(row, term);
    const normalized = (details.get(row.kcdm) ?? []).map((data) =>
      normalizeSection(data, course.id, term),
    );
    const owners = new Set(
      normalized.flatMap((value) => {
        const existing = sections.get(value.id);
        return existing ? [existing.courseId] : [];
      }),
    );
    if (owners.size) {
      const owner = [...owners][0];
      const existing = owner ? courses.get(owner) : undefined;
      const priorSections = owner ? (courseSections.get(owner) ?? []) : [];
      const priorIds = new Set(priorSections.map((value) => value.id));
      const incomingIds = new Set(normalized.map((value) => value.id));
      const nested =
        priorSections.every((value) => incomingIds.has(value.id)) ||
        normalized.every((value) => priorIds.has(value.id));
      if (
        !owner ||
        !existing ||
        owners.size !== 1 ||
        !row.xskcdm?.trim() ||
        courseSignature(existing) !== courseSignature(course) ||
        !nested ||
        sectionSignature(
          priorSections.filter((value) => incomingIds.has(value.id)),
        ) !==
          sectionSignature(normalized.filter((value) => priorIds.has(value.id)))
      )
        return fail("UPSTREAM_SCHEMA_CHANGED", "教学班重复或归属不一致。");
      aliases.set(row.kcdm, owner);
      for (const value of normalized) {
        if (!priorIds.has(value.id)) {
          const canonical = { ...value, courseId: owner };
          sections.set(value.id, canonical);
          priorSections.push(canonical);
        }
      }
      continue;
    }
    const prior = courses.get(course.id);
    if (prior && courseSignature(prior) !== courseSignature(course))
      return fail(
        "UPSTREAM_SCHEMA_CHANGED",
        "重复课程的元数据不一致，未发布快照。",
      );
    courses.set(course.id, course);
    aliases.set(row.kcdm, course.id);
    courseSections.set(course.id, normalized);
    for (const section of normalized) sections.set(section.id, section);
  }
  const baseline: string[] = [];
  const volunteers = [];
  for (const row of chosen) {
    const id = opaque("section", term.id, row.xkkh);
    // The exact section selection code is the enrolled identity. The chosen
    // endpoint may use a different directory selector for this same section.
    const existingSection = sections.get(id);
    const courseId =
      existingSection?.courseId ??
      aliases.get(row.kcdm) ??
      opaque("course", term.id, row.kcdm);
    const existingCourse = courses.get(courseId);
    const chosenCredits = number(row.xf);
    if (
      existingSection &&
      existingCourse &&
      ((row.xskcdm?.trim() && plain(row.xskcdm) !== existingCourse.code) ||
        (chosenCredits.state === "known" &&
          existingCourse.credits.state === "known" &&
          chosenCredits.value !== existingCourse.credits.value))
    )
      return fail(
        "UPSTREAM_SCHEMA_CHANGED",
        "已选课程序号与课程元数据不一致。",
      );
    if (!courses.has(courseId))
      courses.set(
        courseId,
        Course.parse({
          id: courseId,
          termId: term.id,
          code: plain(row.xskcdm || row.kcdm),
          title: plain(row.kcmc),
          credits: number(row.xf),
          category: unknown(),
          college: unknown(),
          hasPrerequisite: unknown(),
        }),
      );
    if (!sections.has(id)) {
      const detailed = details.get(row.kcdm)?.find((s) => s.xkkh === row.xkkh);
      sections.set(
        id,
        normalizeSection(detailed ?? row, courseId, term, false),
      );
    }
    if (sections.get(id)?.courseId !== courseId)
      return fail("UPSTREAM_SCHEMA_CHANGED", "已选课程归属不一致。");
    if (row.sxbj === "1") baseline.push(id);
    else if (row.sxbj !== "0")
      return fail(
        "UPSTREAM_SCHEMA_CHANGED",
        "选上状态字段发生变化，不能确认锁定基线。",
      );
    if (row.sxbj === "0")
      volunteers.push({
        sectionId: id,
        priority:
          row.xkzy && row.xkzy <= 3
            ? known(row.xkzy)
            : unknown(undefined, "not_verified"),
        courseGroupId: unknown(undefined, "not_verified"),
        timeGroupIds: unknown(undefined, "not_verified"),
      });
  }
  return Snapshot.parse({
    meta: {
      schemaVersion: 1,
      id: opaque("snapshot", term.id, capturedAt),
      termId: term.id,
      capturedAt,
      provenance: {
        origin: "live",
        synthetic: false,
        sources: [
          {
            provider: "zdbk",
            url: `${SCHOOL_ORIGIN}${READ_PATHS.index}`,
            observedAt: capturedAt,
          },
        ],
      },
      availability: "unknown",
      coverage: "complete",
      courseCount: courses.size,
      sectionCount: sections.size,
    },
    term,
    courses: [...courses.values()],
    sections: [...sections.values()],
    enrolledSectionIds: known([...new Set(baseline)]),
    officialVolunteers: known(volunteers),
    academicContext: {
      officialCreditLimit: unknown(undefined, "not_verified"),
    },
    rules: {
      id: opaque("rules", term.id),
      verification: "provisional",
      courseVolunteerLimit: 3,
      timeGroupVolunteerLimit: 3,
      evidence: [
        {
          provider: "zdbk",
          url: `${SCHOOL_ORIGIN}${READ_PATHS.index}`,
          observedAt: capturedAt,
        },
      ],
      unresolved: ["time_group_mapping", "priority_mapping", "rule_window"],
    },
  });
}
