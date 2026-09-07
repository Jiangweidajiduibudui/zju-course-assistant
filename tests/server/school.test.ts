import { expect, it, vi } from "vitest";
import { originalSnapshot } from "../../fixtures/ui/catalog.js";
import { Store } from "../../src/server/storage/store.js";
import {
  allowedLogin,
  allowedRead,
  READ_PATHS,
  SCHOOL_ORIGIN,
} from "../../src/server/zdbk/allowlist.js";
import { SchoolJobs } from "../../src/server/zdbk/jobs.js";
import {
  assemble,
  ChosenRow,
  CourseRow,
  normalizeExam,
  normalizeMeetings,
  normalizeSection,
  normalizeTerm,
  SectionRow,
} from "../../src/server/zdbk/normalize.js";
import type { SchoolDriver } from "../../src/server/zdbk/read.js";
import { readPageContext } from "../../src/server/zdbk/session.js";

const context = {
  year: "2026-2027",
  code: "1",
  principal: "synthetic-account",
  quotaDisplay: "0",
  parts: ["秋", "冬"],
};
const term = normalizeTerm(context, [
  { xxq: "秋", zc: 1, dxqzc: 1 },
  { xxq: "冬", zc: 1, dxqzc: 9 },
]);
const course = {
  rn: "1",
  kcdm: "synthetic-course",
  kcmc: "合成课程",
  xkkh: "synthetic-section",
  kcxx: "0~3.0~3.0-0.0",
};
const section = {
  xkkh: course.xkkh,
  jsxm: "合成教师",
  jszgh: "synthetic-teacher",
  xxq: "秋冬",
  sksj: "周一第1,2节",
  rs: "2/20",
  yxrs: "0~0",
};
it("strips unknown raw properties, preserves unknown fields, and excludes personal context", () => {
  const c = CourseRow.parse({
    ...course,
    userModel: { studentId: "private-value" },
  });
  const s = SectionRow.parse({
    ...section,
    userModel: { studentId: "private-value" },
  });
  const b = ChosenRow.parse({ ...c, ...s, xf: "3", sxbj: "1", xkzy: 1 });
  const snapshot = assemble(
    context,
    [],
    [c],
    new Map([[c.kcdm, [s]]]),
    [b],
    "2026-09-06T00:00:00Z",
  );
  expect(JSON.stringify(snapshot)).not.toMatch(
    /private-value|synthetic-account|userModel/,
  );
  expect(snapshot.enrolledSectionIds.state).toBe("known");
  expect(snapshot.rules.verification).toBe("provisional");
  const row = snapshot.sections[0];
  expect(row?.officialState).toBe("available");
  expect(row?.exams.state).toBe("unknown");
  expect(row?.quotas.male.remaining.state).toBe("unknown");
  expect(row?.pending.all).toEqual({ state: "known", value: 0 });
});
it("parses explicit part weeks, discontinuous periods, unknown syntax and exams", () => {
  const parsed = normalizeMeetings(
    "周一第1,2,4节{秋1-4周;冬1-8周}",
    term.parts,
  );
  expect(parsed.state).toBe("known");
  if (parsed.state !== "known") throw new Error("fixture");
  expect(parsed.value).toHaveLength(4);
  expect(parsed.value[0]?.slot.weeks).toEqual([1, 2, 3, 4]);
  expect(normalizeMeetings("安排另行通知", term.parts).state).toBe("unknown");
  expect(normalizeExam("2027年01月08日(18:30-20:30)").state).toBe("known");
  expect(normalizeExam("2027年02月31日(18:30-20:30)").state).toBe("unknown");
  expect(
    normalizeSection(
      { ...section, rs: "undefined", jsxm: "未知" },
      "course",
      term,
    ).quotas.overall.remaining.state,
  ).toBe("unknown");
});
it("requires the authenticated page fields and never treats a login page as context", () => {
  expect(() => readPageContext("<html>login</html>")).toThrow();
  const data = readPageContext(
    '<input id="xn" value="2026-2027"><input value="1" id="xq"><input id="sessionUserKey" value="synthetic"><a data-xxq="秋"></a>',
  );
  expect(data.year).toBe("2026-2027");
  expect(data.parts).toEqual(["秋"]);
});
it("permits only exact school read methods and the bounded authentication surface", () => {
  for (const [name, path] of Object.entries(READ_PATHS))
    expect(
      allowedRead(
        `${SCHOOL_ORIGIN}${path}?gnmkdm=N253530`,
        name === "index" ? "GET" : "POST",
      ),
    ).toBe(true);
  for (const url of [
    `${SCHOOL_ORIGIN}/jwglxt/xsxk/unverified.html`,
    `${SCHOOL_ORIGIN}${READ_PATHS.courses}?extra=1`,
    `https://other.example${READ_PATHS.index}`,
  ])
    expect(allowedRead(url, "POST")).toBe(false);
  expect(allowedRead(`${SCHOOL_ORIGIN}${READ_PATHS.courses}`, "GET")).toBe(
    false,
  );
  expect(
    allowedLogin(
      `${SCHOOL_ORIGIN}/jwglxt/xtgl/index_initMenu.html;jsessionid=synthetic`,
      "GET",
      "document",
    ),
  ).toBe(true);
  expect(
    allowedLogin(`${SCHOOL_ORIGIN}${READ_PATHS.sections}`, "POST", "xhr"),
  ).toBe(false);
});
function driver(): SchoolDriver {
  return {
    status: () => ({
      state: "authenticated",
      checkedAt: new Date().toISOString(),
    }),
    login: async () => {},
    terms: () => [term],
    snapshot: async () => ({
      ...structuredClone(originalSnapshot),
      meta: {
        ...originalSnapshot.meta,
        id: "snapshot-live-test",
        provenance: {
          ...originalSnapshot.meta.provenance,
          origin: "live",
          synthetic: false,
        },
      },
    }),
    committed: vi.fn(),
    clearBinding: vi.fn(),
    logout: async () => {},
    close: async () => {},
  };
}
it("publishes a completed snapshot atomically and leaves old data intact on failure", async () => {
  const store = new Store(":memory:");
  store.insertSnapshot(originalSnapshot);
  const d = driver(),
    jobs = new SchoolJobs(store, d);
  try {
    const job = jobs.start("sync", term.id);
    await vi.waitFor(() => expect(jobs.get(job.id).status).toBe("succeeded"));
    expect(store.latest(originalSnapshot.term.id)).toBe("snapshot-live-test");
    expect(d.committed).toHaveBeenCalledOnce();
    d.snapshot = async () => {
      throw new Error("private raw text");
    };
    const failure = jobs.start("sync", term.id);
    await vi.waitFor(() => expect(jobs.get(failure.id).status).toBe("failed"));
    expect(JSON.stringify(jobs.get(failure.id))).not.toContain(
      "private raw text",
    );
    expect(store.snapshots()).toHaveLength(2);
  } finally {
    await jobs.close();
    store.close();
  }
});
it("cancellation fences a late snapshot response and serializes concurrent jobs", async () => {
  const store = new Store(":memory:"),
    d = driver(),
    jobs = new SchoolJobs(store, d);
  const snapshot = await d.snapshot(
    term.id,
    new AbortController().signal,
    () => {},
  );
  let finish: (value: typeof snapshot) => void = () => {};
  d.snapshot = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  try {
    const job = jobs.start("sync", term.id);
    await vi.waitFor(() => expect(jobs.get(job.id).status).toBe("running"));
    expect(() => jobs.start("login")).toThrow();
    jobs.cancel(job.id);
    finish(snapshot);
    await jobs.close();
    expect(store.snapshots()).toHaveLength(0);
    expect(jobs.get(job.id).status).toBe("cancelled");
    expect(d.committed).not.toHaveBeenCalled();
  } finally {
    store.close();
  }
});

it("subdivides the current 50-course cap and proves the unobserved-prefix complement", async () => {
  const { LiveSchool } = await import("../../src/server/zdbk/read.js");
  const source = Array.from({ length: 123 }, (_, i) => ({
    ...course,
    kcdm: `${i < 110 ? "A" : "Z"}${String(i).padStart(4, "0")}`,
    xkkh: `section-${i}`,
  }));
  const queries: Record<string, string>[] = [];
  const session = {
    status: () => ({
      state: "authenticated" as const,
      checkedAt: new Date().toISOString(),
    }),
    login: async () => context,
    cachedContext: () => context,
    context: async () => context,
    assertScope: () => {},
    scope: () => "synthetic-scope",
    bind: () => {},
    clearBinding: () => {},
    logout: async () => {},
    close: async () => {},
    read: async (name: string, form: Record<string, string>) => {
      if (name === "weeks")
        return JSON.stringify({ status: "success", result: [] });
      if (name === "chosen") return "[]";
      if (name === "sections")
        return JSON.stringify([{ ...section, xkkh: form.xkkh }]);
      if (name !== "courses") throw new Error("Unreviewed read");
      queries.push(form);
      const prefix = form["cxtjList[0].cxnr"] ?? "";
      const excluded = Object.entries(form)
        .filter(([key]) => /^cxtjList\[[1-9]\d*\]\.cxnr$/.test(key))
        .map(([, value]) => value);
      return JSON.stringify(
        source
          .filter(
            (r) =>
              r.kcdm.startsWith(prefix) &&
              !excluded.some((p) => r.kcdm.startsWith(p)),
          )
          .slice(0, 50)
          .map((r, i) => ({ ...r, rn: String(i + 1) })),
      );
    },
  };
  const snapshot = await new LiveSchool(session).snapshot(
    term.id,
    new AbortController().signal,
    () => {},
  );
  expect(snapshot.courses).toHaveLength(123);
  expect(snapshot.sections).toHaveLength(123);
  expect(snapshot.meta.coverage).toBe("complete");
  expect(queries.some((q) => q["cxtjList[1].cxgx"] === "notleftlike")).toBe(
    true,
  );
});

it("preserves negative quota display without clamping and separates official capacity from conflicts", () => {
  const row = normalizeSection(
    { ...section, rs: "-7/37", sfxz: "0" },
    "course",
    term,
  );
  expect(row.officialState).toBe("unavailable");
  expect(row.quotas.overall.remaining).toEqual({
    state: "unknown",
    reason: "not_parsed",
    displayText: "-7",
  });
  expect(row.officialTimeConflict.state).toBe("unknown");
  expect(
    normalizeSection({ ...section, rs: undefined, sfxz: "1" }, "course", term)
      .officialState,
  ).toBe("unknown");
});

it("retains account binding when a planning clear rolls back", async () => {
  const { Service } = await import("../../src/server/service.js");
  const store = new Store(":memory:"),
    d = driver();
  const service = new Service(
    store,
    "synthetic-token",
    undefined,
    undefined,
    d,
  );
  try {
    store.insertSnapshot(originalSnapshot);
    const preview = service.execute(
      "previewClear",
      {},
      {},
      { scope: "planning" },
    ) as { id: string; expectedDataRevision: number };
    store.db.exec(
      "CREATE TRIGGER stop_clear BEFORE DELETE ON snapshots BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    await expect(
      service.execute(
        "applyClear",
        { previewId: preview.id },
        {},
        { expectedDataRevision: preview.expectedDataRevision, confirm: true },
      ),
    ).rejects.toThrow();
    expect(d.clearBinding).not.toHaveBeenCalled();
    expect(store.snapshots()).toHaveLength(1);
  } finally {
    await service.school?.close();
    store.close();
  }
});

it("never returns a cached snapshot from a rolled-back insert", () => {
  const store = new Store(":memory:");
  try {
    expect(() =>
      store.transaction(() => {
        store.insertSnapshot(originalSnapshot);
        store.snapshot(originalSnapshot.meta.id);
        throw new Error("rollback");
      }),
    ).toThrow("rollback");
    expect(() => store.snapshot(originalSnapshot.meta.id)).toThrow(
      "快照不存在",
    );
  } finally {
    store.close();
  }
});

it("deduplicates nested directory aliases without losing concrete sections or accepting metadata conflicts", () => {
  const left = { ...course, kcdm: "alias-A", xskcdm: "SYN101" },
    right = { ...course, kcdm: "alias-B", xskcdm: "SYN101" };
  const chosen = ChosenRow.parse({ ...section, ...right, xf: "3", sxbj: "1" });
  const run = (items: (typeof section)[], metadata = right) =>
    assemble(
      context,
      [],
      [left, metadata],
      new Map([
        [left.kcdm, [section]],
        [right.kcdm, items],
      ]),
      [chosen],
      "2026-09-06T00:00:00Z",
    );
  const merged = run([section]);
  expect(merged.courses).toHaveLength(1);
  expect(merged.sections).toHaveLength(1);
  expect(merged.enrolledSectionIds).toEqual({
    state: "known",
    value: [merged.sections[0]?.id],
  });
  expect(
    run([section, { ...section, xkkh: "distinct-section" }]).sections,
  ).toHaveLength(2);
  expect(() => run([section], { ...right, kcxx: "0~4.0~4.0-0.0" })).toThrow(
    "归属不一致",
  );
  expect(() => run([{ ...section, rs: "3/20" }])).toThrow("归属不一致");
});

it("keeps identically named courses and distinct section selection codes separate", () => {
  const first = { ...course, kcdm: "synthetic-A", xskcdm: "SYN-A" },
    second = { ...course, kcdm: "synthetic-B", xskcdm: "SYN-B" };
  const snapshot = assemble(
    context,
    [],
    [first, second],
    new Map([
      [first.kcdm, [section]],
      [second.kcdm, [{ ...section, xkkh: "second-selection-code" }]],
    ]),
    [],
    "2026-09-06T00:00:00Z",
  );
  expect(snapshot.courses).toHaveLength(2);
  expect(snapshot.sections).toHaveLength(2);
  expect(
    new Set(
      snapshot.sections.map((s) =>
        s.selectionCode.state === "known" ? s.selectionCode.value : "",
      ),
    ),
  ).toHaveLength(2);
});

it("anchors enrolled records by exact section code across directory selector aliases", () => {
  const catalog = { ...course, xskcdm: "SYN101" };
  const chosen = ChosenRow.parse({
    ...section,
    kcdm: "other-directory-selector",
    xskcdm: "SYN101",
    kcmc: course.kcmc,
    xf: "3",
    sxbj: "1",
  });
  const snapshot = assemble(
    context,
    [],
    [catalog],
    new Map([[catalog.kcdm, [section]]]),
    [chosen],
    "2026-09-06T00:00:00Z",
  );
  expect(snapshot.courses).toHaveLength(1);
  expect(snapshot.sections).toHaveLength(1);
  expect(snapshot.enrolledSectionIds).toEqual({
    state: "known",
    value: [snapshot.sections[0]?.id],
  });
  expect(() =>
    assemble(
      context,
      [],
      [catalog],
      new Map([[catalog.kcdm, [section]]]),
      [{ ...chosen, xf: "4" }],
      "2026-09-06T00:00:00Z",
    ),
  ).toThrow("元数据不一致");
});
