import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { z } from "zod";
import {
  Snapshot,
  type SnapshotData,
  SnapshotMeta,
  Term,
} from "../../shared/contracts/catalog.js";
import { PlanSnapshot } from "../../shared/contracts/context.js";
import { PlanningJob } from "../../shared/contracts/llm.js";
import { Job } from "../../shared/contracts/operations.js";
import { Plan, type PlanData } from "../../shared/contracts/planning.js";
import { fail } from "../errors.js";
import { migrations } from "./migrations.js";

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export class Store {
  private snapshotCache = new Map<string, SnapshotData>();
  clearSnapshotCache() {
    this.snapshotCache.clear();
  }
  counts() {
    return {
      plans: (
        this.db.prepare("SELECT count(*) AS n FROM plans").get() as {
          n: number;
        }
      ).n,
      snapshots: (
        this.db.prepare("SELECT count(*) AS n FROM snapshots").get() as {
          n: number;
        }
      ).n,
    };
  }
  snapshotSummaries(term?: string) {
    const sql =
      "SELECT json_extract(data,'$.meta') AS meta,json_extract(data,'$.term') AS term FROM snapshots";
    const rows = (
      term
        ? this.db
            .prepare(`${sql} WHERE term_id=? ORDER BY captured_at DESC,id`)
            .all(term)
        : this.db.prepare(`${sql} ORDER BY captured_at DESC,id`).all()
    ) as { meta: string; term: string }[];
    return rows.map((row) => ({
      meta: SnapshotMeta.parse(JSON.parse(row.meta)),
      term: Term.parse(JSON.parse(row.term)),
    }));
  }

  readonly db: Database.Database;
  constructor(readonly file: string) {
    if (file !== ":memory:") {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      chmodSync(dirname(file), 0o700);
    }
    const existed = file !== ":memory:" && existsSync(file);
    this.db = new Database(file);
    if (file !== ":memory:") chmodSync(file, 0o600);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > migrations.length) {
      this.db.close();
      throw new Error(
        "Database is newer than this application; no changes made",
      );
    }
    if (existed && version < migrations.length)
      this.db
        .prepare("VACUUM INTO ?")
        .run(`${file}.before-v${migrations.length}-${Date.now()}.bak`);
    this.db.transaction(() => {
      for (let i = version; i < migrations.length; i++) {
        const sql = migrations[i];
        if (sql) this.db.exec(sql);
        this.db.pragma(`user_version = ${i + 1}`);
      }
    })();
    this.db.pragma("journal_mode = WAL");
    this.db.transaction(() => {
      for (const job of this.resources("school-job", Job))
        if (["queued", "running"].includes(job.status))
          this.put("school-job", job.id, {
            id: job.id,
            kind: job.kind,
            status: "cancelled",
            error: null,
            finishedAt: new Date().toISOString(),
          });
      for (const job of this.resources("job", PlanningJob))
        if (["queued", "running"].includes(job.status))
          this.put("job", job.id, {
            ...job,
            status: "cancelled",
            proposals: [],
            error: null,
            finishedAt: new Date().toISOString(),
          });
    })();
  }
  close() {
    this.clearSnapshotCache();
    this.db.close();
  }
  transaction<T>(work: () => T): T {
    return this.db.transaction(work).immediate();
  }
  revision() {
    return (
      this.db.prepare("SELECT revision FROM state WHERE id=1").get() as {
        revision: number;
      }
    ).revision;
  }
  bump() {
    this.db.prepare("UPDATE state SET revision=revision+1 WHERE id=1").run();
    return this.revision();
  }
  put(kind: string, id: string, data: unknown) {
    this.db
      .prepare(
        "INSERT INTO resources(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, id, JSON.stringify(data));
  }
  get<T extends z.ZodType>(
    kind: string,
    id: string,
    schema: T,
  ): z.infer<T> | null {
    const row = this.db
      .prepare("SELECT data FROM resources WHERE kind=? AND id=?")
      .get(kind, id) as { data: string } | undefined;
    return row ? schema.parse(JSON.parse(row.data)) : null;
  }
  resources<T extends z.ZodType>(kind: string, schema: T): z.infer<T>[] {
    return (
      this.db
        .prepare("SELECT data FROM resources WHERE kind=? ORDER BY id")
        .all(kind) as { data: string }[]
    ).map((row) => schema.parse(JSON.parse(row.data)));
  }
  remove(kind: string, id: string) {
    this.db
      .prepare("DELETE FROM resources WHERE kind=? AND id=?")
      .run(kind, id);
  }
  snapshot(id: string): SnapshotData {
    const cached = this.snapshotCache.get(id);
    if (
      cached &&
      this.db.prepare("SELECT 1 FROM snapshots WHERE id=?").get(id)
    ) {
      this.snapshotCache.delete(id);
      this.snapshotCache.set(id, cached);
      return cached;
    }
    this.snapshotCache.delete(id);
    const row = this.db
      .prepare("SELECT data FROM snapshots WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row) return fail("NOT_FOUND", "快照不存在。");
    const snapshot = freeze(Snapshot.parse(JSON.parse(row.data)));
    this.snapshotCache.set(id, snapshot);
    while (this.snapshotCache.size > 3) {
      const oldest = this.snapshotCache.keys().next().value;
      if (oldest) this.snapshotCache.delete(oldest);
    }
    return snapshot;
  }
  snapshots(term?: string): SnapshotData[] {
    const rows = (
      term
        ? this.db
            .prepare(
              "SELECT data FROM snapshots WHERE term_id=? ORDER BY captured_at DESC,id",
            )
            .all(term)
        : this.db
            .prepare("SELECT data FROM snapshots ORDER BY captured_at DESC,id")
            .all()
    ) as { data: string }[];
    return rows.map((row) => Snapshot.parse(JSON.parse(row.data)));
  }
  latest(term: string): string | null {
    const row = this.db
      .prepare(
        "SELECT id FROM snapshots WHERE term_id=? AND live=1 ORDER BY captured_at DESC,rowid DESC LIMIT 1",
      )
      .get(term) as { id: string } | undefined;
    return row?.id ?? null;
  }
  insertSnapshot(raw: SnapshotData) {
    const snapshot = Snapshot.parse(raw);
    this.db
      .prepare("INSERT INTO snapshots VALUES(?,?,?,?,?)")
      .run(
        snapshot.meta.id,
        snapshot.meta.termId,
        snapshot.meta.capturedAt,
        snapshot.meta.provenance.origin === "live" ? 1 : 0,
        JSON.stringify(snapshot),
      );
  }
  plan(id: string, revision?: number): PlanData {
    const row = this.db.prepare("SELECT data FROM plans WHERE id=?").get(id) as
      | { data: string }
      | undefined;
    if (!row) return fail("NOT_FOUND", "计划不存在。");
    const plan = Plan.parse(JSON.parse(row.data));
    if (revision !== undefined && plan.revision !== revision)
      return fail("REVISION_CONFLICT", "计划版本已变化，请刷新后重试。");
    return plan;
  }
  plans(term?: string): PlanData[] {
    const rows = (
      term
        ? this.db
            .prepare("SELECT data FROM plans WHERE term_id=? ORDER BY rowid")
            .all(term)
        : this.db.prepare("SELECT data FROM plans ORDER BY rowid").all()
    ) as { data: string }[];
    return rows.map((row) => Plan.parse(JSON.parse(row.data)));
  }
  insertPlan(raw: PlanData) {
    const plan = Plan.parse(raw);
    PlanSnapshot.parse({ plan, snapshot: this.snapshot(plan.snapshotId) });
    this.db
      .prepare("INSERT INTO plans VALUES(?,?,?,?,?)")
      .run(
        plan.id,
        plan.termId,
        plan.snapshotId,
        plan.revision,
        JSON.stringify(plan),
      );
    this.bump();
  }
  updatePlan(raw: PlanData, expected: number) {
    const plan = Plan.parse(raw);
    PlanSnapshot.parse({ plan, snapshot: this.snapshot(plan.snapshotId) });
    if (plan.revision !== expected + 1)
      fail("REVISION_CONFLICT", "非法计划修订。");
    const changed = this.db
      .prepare(
        "UPDATE plans SET snapshot_id=?,revision=?,data=? WHERE id=? AND revision=?",
      )
      .run(
        plan.snapshotId,
        plan.revision,
        JSON.stringify(plan),
        plan.id,
        expected,
      );
    if (!changed.changes) fail("REVISION_CONFLICT", "计划版本已变化。");
    this.bump();
  }
  deletePlan(id: string, revision: number) {
    this.plan(id, revision);
    this.db
      .prepare("DELETE FROM plans WHERE id=? AND revision=?")
      .run(id, revision);
    this.bump();
  }
  cached(key: string, hash: string): unknown | null {
    const row = this.db
      .prepare("SELECT request_hash,response FROM idempotency WHERE key=?")
      .get(key) as { request_hash: string; response: string } | undefined;
    if (!row) return null;
    if (row.request_hash !== hash)
      return fail("IDEMPOTENCY_CONFLICT", "幂等键已用于其他请求。");
    return JSON.parse(row.response);
  }
  cache(key: string, hash: string, response: unknown) {
    this.db
      .prepare("INSERT INTO idempotency VALUES(?,?,?)")
      .run(key, hash, JSON.stringify(response));
  }
}
