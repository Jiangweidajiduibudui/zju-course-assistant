import { describe, expect, it } from "vitest";
import { z } from "zod";
import { api } from "../../src/shared/contracts/api.js";
import {
  Exam,
  Ruleset,
  Section,
  Snapshot,
  TeachingSlot,
} from "../../src/shared/contracts/catalog.js";
import {
  Failure,
  field,
  HttpsUrl,
  success,
} from "../../src/shared/contracts/common.js";
import {
  Acknowledgement,
  PlanSnapshot,
} from "../../src/shared/contracts/context.js";
import {
  llmTasks,
  SummaryExchange,
  TimetableExchange,
} from "../../src/shared/contracts/llm.js";
import {
  CredentialStatus,
  Job,
  LocalArchive,
  SessionStatus,
  SettingsContent,
} from "../../src/shared/contracts/operations.js";
import {
  Draft,
  PlanContent,
  ValidationReport,
} from "../../src/shared/contracts/planning.js";
import { TeacherMatch } from "../../src/shared/contracts/reviews.js";
import { at, known, plan, snapshot, stamp, unknown } from "./fixtures.js";

describe("official observations and immutable snapshot structure", () => {
  it("retains unknown quota separately from an observed zero", () => {
    const quota = snapshot.sections[0]?.quotas;
    expect(quota?.overall.remaining).toEqual(known(0));
    expect(quota?.male.remaining).toEqual(unknown);
    for (const bad of [null, "undefined", "", -1])
      expect(
        field(z.number().nonnegative()).safeParse(known(bad)).success,
      ).toBe(false);
  });
  it("keeps time-equivalent sections distinct and ratings outside the official schema", () => {
    expect(snapshot.sections[0]?.meetings).toEqual(
      snapshot.sections[1]?.meetings,
    );
    expect(snapshot.sections[0]?.id).not.toBe(snapshot.sections[1]?.id);
    expect(
      Section.safeParse({ ...snapshot.sections[0], rating: 5 }).success,
    ).toBe(false);
  });
  it.each([
    "wrong-course",
    "wrong-term",
    "duplicate-section",
    "wrong-count",
    "missing-baseline",
    "wrong-part",
  ])("rejects a broken snapshot graph: %s", (kind) => {
    const data = structuredClone(snapshot);
    const section = data.sections[0];
    if (!section) throw new Error("Fixture missing section");
    if (kind === "wrong-course") section.courseId = "absent";
    if (kind === "wrong-term") section.termId = "other-term";
    if (kind === "duplicate-section") data.sections.push(section);
    if (kind === "wrong-count") data.meta.sectionCount = 0;
    if (kind === "missing-baseline")
      data.enrolledSectionIds = known(["absent"]);
    if (kind === "wrong-part") section.partIds = ["absent"];
    expect(Snapshot.safeParse(data).success).toBe(false);
  });
  it("rejects reversed time intervals and duplicate weeks", () => {
    expect(
      TeachingSlot.safeParse({
        partId: "part",
        weeks: [1, 1],
        weekday: 1,
        startPeriod: 1,
        endPeriod: 2,
      }).success,
    ).toBe(false);
    expect(
      TeachingSlot.safeParse({
        partId: "part",
        weeks: [1],
        weekday: 1,
        startPeriod: 3,
        endPeriod: 2,
      }).success,
    ).toBe(false);
    expect(
      Exam.safeParse({
        startsAt: "2026-09-06T11:00:00+08:00",
        endsAt: "2026-09-06T10:00:00+08:00",
        location: unknown,
      }).success,
    ).toBe(false);
  });
  it("cannot declare provisional rule observations verified", () => {
    expect(
      Ruleset.safeParse({ ...snapshot.rules, verification: "verified" })
        .success,
    ).toBe(false);
  });
});

describe("planning wire invariants", () => {
  it("joins a plan to the exact snapshot and rejects wrong-course preferences", () => {
    expect(PlanSnapshot.safeParse({ plan, snapshot }).success).toBe(true);
    const bad = structuredClone(plan);
    bad.snapshotId = "another-snapshot";
    expect(PlanSnapshot.safeParse({ plan: bad, snapshot }).success).toBe(false);
    bad.snapshotId = plan.snapshotId;
    const entry = bad.content.shortlist[0];
    if (!entry) throw new Error("Missing fixture entry");
    entry.courseId = "other-course";
    bad.unresolvedCourseIds = ["other-course"];
    expect(PlanSnapshot.safeParse({ plan: bad, snapshot }).success).toBe(false);
  });
  it.each([
    { actual: ["a"], valid: false },
    { actual: ["a", "b", "x"], valid: false },
    { actual: ["a", "a"], valid: false },
    { actual: ["b", "a"], valid: true },
  ])("requires exact confirmation sets: $actual", ({ actual, valid }) => {
    expect(
      Acknowledgement.safeParse({
        expectedIds: ["a", "b"],
        acknowledgedIds: actual,
      }).success,
    ).toBe(valid);
  });
  it("retains a fourth preference for reporting, without permitting a forged valid report", () => {
    const content = structuredClone(plan.content);
    content.shortlist[0]?.items.push(
      {
        sectionId: "section-c",
        disposition: "candidate",
        favorite: false,
        note: "",
      },
      {
        sectionId: "section-d",
        disposition: "candidate",
        favorite: false,
        note: "",
      },
    );
    expect(PlanContent.parse(content).shortlist[0]?.items).toHaveLength(4);
    const issue = {
      id: "issue-limit",
      code: "COURSE_VOLUNTEER_LIMIT",
      severity: "error",
      courseIds: ["course-fixture"],
      sectionIds: ["section-d"],
      timeGroupId: null,
      slot: null,
      message: "Fourth preference exceeds the course limit",
    };
    const draft = Draft.parse({
      stamp,
      entries: [
        {
          courseId: "course-fixture",
          sectionId: "section-d",
          priority: 4,
          timeGroupIds: unknown,
        },
      ],
      validation: { status: "invalid", issues: [issue] },
    });
    expect(draft.entries[0]?.priority).toBe(4);
    expect(
      ValidationReport.safeParse({ status: "valid", issues: [issue] }).success,
    ).toBe(false);
  });
  it("preserves unknown and warning semantics", () => {
    const issue = {
      id: "issue-unknown",
      code: "BASELINE_UNKNOWN",
      severity: "unknown",
      courseIds: [],
      sectionIds: [],
      timeGroupId: null,
      slot: null,
      message: "No verified enrolled baseline",
    };
    expect(
      ValidationReport.safeParse({ status: "valid", issues: [issue] }).success,
    ).toBe(false);
    expect(
      ValidationReport.safeParse({ status: "indeterminate", issues: [issue] })
        .success,
    ).toBe(true);
    expect(
      ValidationReport.safeParse({
        status: "valid",
        issues: [{ ...issue, code: "TEACHING_OVERLAP", severity: "warning" }],
      }).success,
    ).toBe(true);
  });
  it("requires optimistic concurrency and rejects client-authored derived state", () => {
    expect(
      api.updatePlan.body.safeParse({ content: plan.content }).success,
    ).toBe(false);
    expect(
      api.updatePlan.body.safeParse({
        expectedRevision: 1,
        content: plan.content,
        snapshotId: "forged",
        validation: { status: "valid", issues: [] },
      }).success,
    ).toBe(false);
    expect(
      api.updatePlan.body.safeParse({
        expectedRevision: 1,
        content: plan.content,
      }).success,
    ).toBe(true);
  });
  it("rejects duplicate section preferences", () => {
    const content = structuredClone(plan.content);
    const first = content.shortlist[0]?.items[0];
    if (!first) throw new Error("Fixture missing preference");
    content.shortlist[0]?.items.push(first);
    expect(PlanContent.safeParse(content).success).toBe(false);
  });
});

describe("LLM output confinement", () => {
  const input = {
    profile: plan.content.preferences,
    targets: [
      {
        course: snapshot.courses[0],
        orderedSectionIds: ["section-a", "section-b"],
      },
    ],
    sections: snapshot.sections,
    baselineSectionIds: [],
    reviewEvidence: [],
  };
  it.each([
    [],
    [{ courseId: "course-fixture", sectionId: "invented", reason: "test" }],
    [{ courseId: "wrong", sectionId: "section-a", reason: "test" }],
    [
      { courseId: "course-fixture", sectionId: "section-a", reason: "test" },
      { courseId: "course-fixture", sectionId: "section-a", reason: "test" },
    ],
  ])("rejects incomplete or fabricated selections", (...selections) => {
    expect(
      TimetableExchange.safeParse({
        input,
        output: { selections, explanation: "test" },
      }).success,
    ).toBe(false);
  });
  it("accepts only the actual course candidate", () => {
    expect(
      TimetableExchange.safeParse({
        input,
        output: {
          selections: [
            {
              courseId: "course-fixture",
              sectionId: "section-b",
              reason: "test",
            },
          ],
          explanation: "test",
        },
      }).success,
    ).toBe(true);
  });
  it("rejects fabricated sample sizes and browser-supplied model payloads", () => {
    const input = {
      subjectRef: "subject",
      untrustedComments: [{ id: "comment", text: "Synthetic comment" }],
      lowSampleThreshold: 5,
    };
    const output = {
      pros: [],
      cons: [],
      attendance: {
        status: "insufficient_evidence",
        text: "Insufficient evidence",
      },
      sampleSize: 20,
      lowSample: false,
    };
    expect(SummaryExchange.safeParse({ input, output }).success).toBe(false);
    expect(
      SummaryExchange.safeParse({
        input,
        output: { ...output, sampleSize: 1, lowSample: true },
      }).success,
    ).toBe(true);
    expect(
      api.summarizeComments.body.safeParse({
        reviewId: "review",
        expectedReviewRevision: 1,
        endpointId: "endpoint",
        comments: ["Injected input"],
      }).success,
    ).toBe(false);
  });
  it("keeps implemented provider capabilities typed and rejects empty responses", () => {
    expect(Object.keys(llmTasks)).toEqual([
      "summarizeComments",
      "interpretPreferences",
      "generateTimetable",
      "explainProjection",
    ]);
    for (const route of [
      api.interpretPreferences,
      api.generateTimetable,
      api.explainProjection,
    ]) {
      expect(route.availability).toBe("available");
      expect(route.errors).toContain("LLM_NOT_CONFIGURED");
      expect(route.response.safeParse({}).success).toBe(false);
    }
    expect(
      Object.values(api).some((route) =>
        /enumerate|rank-group|compare-arrangements/.test(route.path),
      ),
    ).toBe(false);
  });
});

describe("privacy, archives, and route coherence", () => {
  it("generates resolvable OpenAPI component references and marks keys write-only", () => {
    const document = JSON.parse(
      readFileSync("docs/api/openapi.json", "utf8"),
    ) as Record<string, unknown>;
    let references = 0;
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null) return;
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === "string") {
        expect(object.$ref.startsWith("#/"), object.$ref).toBe(true);
        let target: unknown = document;
        for (const token of object.$ref.slice(2).split("/")) {
          expect(typeof target).toBe("object");
          target = (target as Record<string, unknown>)[
            token.replaceAll("~1", "/").replaceAll("~0", "~")
          ];
          expect(target, object.$ref).toBeDefined();
        }
        references++;
      }
      for (const child of Object.values(object)) visit(child);
    };
    visit(document);
    expect(references).toBeGreaterThan(0);
    expect(document).toMatchObject({
      components: {
        schemas: {
          CredentialInput: { properties: { apiKey: { writeOnly: true } } },
        },
      },
    });
  });
  it("rejects school secrets in status responses and model keys in status DTOs", () => {
    expect(
      SessionStatus.safeParse({
        state: "authenticated",
        checkedAt: at,
        cookies: "synthetic-secret",
      }).success,
    ).toBe(false);
    expect(
      CredentialStatus.safeParse({
        endpointId: "endpoint",
        configured: true,
        storage: "process_memory",
        apiKey: "synthetic-secret",
      }).success,
    ).toBe(false);
    expect(
      HttpsUrl.safeParse("https://example.com/page?su=synthetic").success,
    ).toBe(false);
    expect(HttpsUrl.safeParse("https://user:secret@example.com/").success).toBe(
      false,
    );
  });
  it("only permits the user-approved manual summary trigger", () => {
    const settings = {
      reviewsEnabled: false,
      reviewSources: {
        primary: "https://chalaoshi.de/",
        fallback: "https://chalaoshi.netlify.app/",
      },
      llmEnabled: false,
      summaryTrigger: "manual",
      endpoints: [],
    };
    expect(SettingsContent.safeParse(settings).success).toBe(true);
    expect(
      SettingsContent.safeParse({ ...settings, summaryTrigger: "on_expand" })
        .success,
    ).toBe(false);
  });
  it("does not accept endpoint revisions as user-authored settings", () => {
    const content = {
      reviewsEnabled: false,
      reviewSources: {
        primary: "https://chalaoshi.de/",
        fallback: "https://chalaoshi.netlify.app/",
      },
      llmEnabled: false,
      summaryTrigger: "manual",
      endpoints: [
        {
          id: null,
          label: "Example",
          baseUrl: "https://example.com/v1",
          model: "example-model",
        },
      ],
    };
    expect(
      api.updateSettings.body.safeParse({ expectedRevision: 1, content })
        .success,
    ).toBe(true);
    expect(
      api.updateSettings.body.safeParse({
        expectedRevision: 1,
        content: {
          ...content,
          endpoints: [{ ...content.endpoints[0], revision: 999 }],
        },
      }).success,
    ).toBe(false);
  });
  it("requires known equal colleges for automatic teacher matches", () => {
    const source = {
      provider: "chalaoshi",
      url: "https://example.com/teacher/example/",
      observedAt: at,
    };
    const match = {
      id: "match",
      revision: 1,
      snapshotId: snapshot.meta.id,
      officialTeacher: {
        id: "teacher",
        name: "Synthetic teacher",
        college: known("Synthetic college"),
      },
      sourceId: "primary",
      sourceBaseUrl: "https://example.com/",
      state: {
        status: "matched",
        method: "exact_name_college",
        teacher: {
          id: "external",
          name: "Synthetic teacher",
          college: unknown,
          source,
        },
      },
    };
    expect(TeacherMatch.safeParse(match).success).toBe(false);
    expect(
      TeacherMatch.safeParse({
        ...match,
        state: {
          ...match.state,
          teacher: {
            ...match.state.teacher,
            college: known("Synthetic college"),
          },
        },
      }).success,
    ).toBe(true);
  });
  it("does not publish incomplete snapshots or silent failed jobs", () => {
    expect(
      Snapshot.safeParse({
        ...snapshot,
        meta: { ...snapshot.meta, coverage: "partial" },
      }).success,
    ).toBe(false);
    expect(
      Job.safeParse({
        id: "job",
        kind: "sync",
        status: "failed",
        error: null,
        finishedAt: at,
      }).success,
    ).toBe(false);
    expect(
      Job.safeParse({
        id: "job",
        kind: "sync",
        status: "cancelled",
        error: null,
        finishedAt: at,
      }).success,
    ).toBe(true);
  });
  it("requires self-contained archives and rejects secret/cache extensions", () => {
    const archive = {
      format: "zju-course-assistant",
      schemaVersion: 2,
      exportedAt: at,
      snapshots: [snapshot],
      plans: [plan],
    };
    expect(LocalArchive.safeParse(archive).success).toBe(true);
    expect(LocalArchive.safeParse({ ...archive, snapshots: [] }).success).toBe(
      false,
    );
    expect(
      LocalArchive.safeParse({
        ...archive,
        settings: { apiKey: "synthetic-secret" },
      }).success,
    ).toBe(false);
    expect(
      LocalArchive.safeParse({ ...archive, schemaVersion: 3 }).success,
    ).toBe(false);
    const bad = structuredClone(plan);
    bad.content.shortlist[0]?.items.push({
      sectionId: "absent-section",
      disposition: "candidate",
      favorite: false,
      note: "",
    });
    expect(LocalArchive.safeParse({ ...archive, plans: [bad] }).success).toBe(
      false,
    );
  });
  it("has unique routes, exact path parameters, local auth, and explicit errors", () => {
    const paths = new Set<string>();
    for (const [id, route] of Object.entries(api)) {
      const key = `${route.method} ${route.path}`;
      expect(paths.has(key), key).toBe(false);
      paths.add(key);
      expect(Object.keys(route.params.shape).sort()).toEqual(
        [...route.path.matchAll(/\{([^}]+)\}/g)]
          .map((match) => match[1])
          .sort(),
      );
      expect(route.auth).toBe(id === "bootstrap" ? "bootstrap" : "local-token");
      if (route.method === "GET") expect(route.body).toBeNull();
    }
    const meta = {
      contractVersion: "2.1.0",
      requestId: "request",
      servedAt: at,
    };
    expect(
      success(z.string()).safeParse({ meta, data: "ok", error: {} }).success,
    ).toBe(false);
    expect(
      Failure.safeParse({
        meta,
        error: {
          code: "LLM_NOT_IMPLEMENTED",
          message: "Not implemented",
          retryable: false,
          fields: [],
        },
      }).success,
    ).toBe(true);
  });
});

import { readFileSync } from "node:fs";
