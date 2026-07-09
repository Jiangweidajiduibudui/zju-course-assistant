import { type Catalog, type Session, sessionSchema } from "../../../shared/contracts/index.js";

interface BuildDemoSessionDraftOptions {
  id?: string;
  name?: string;
  now?: Date | string;
}

function normalizeTimestamp(now: Date | string | undefined): string {
  if (now instanceof Date) {
    return now.toISOString();
  }
  return now ?? new Date().toISOString();
}

function defaultSessionId(createdAt: string): string {
  const epochMs = new Date(createdAt).getTime();
  return `demo-session-${Number.isNaN(epochMs) ? Date.now() : epochMs}`;
}

export function buildDemoSessionDraft(
  catalog: Catalog,
  options: BuildDemoSessionDraftOptions = {},
): Session {
  const createdAt = normalizeTimestamp(options.now);
  const session = {
    schemaVersion: "session.v1",
    id: options.id ?? defaultSessionId(createdAt),
    name: options.name ?? "合成 Demo session",
    createdAt,
    baseline: {
      schemaVersion: "baseline.v1",
      selected: [],
      volunteers: [],
      importedAt: createdAt,
    },
    pool: {
      schemaVersion: "pool.v1",
      targets: catalog.courses.map((course) => ({
        courseCode: course.courseCode,
        candidateSectionIds: course.sections.map((section) => section.sectionId),
      })),
    },
    rules: {
      schemaVersion: "rules.v1",
      creditLimit: null,
      bars: [],
    },
    plan: null,
    history: [],
  };

  return sessionSchema.parse(session);
}
