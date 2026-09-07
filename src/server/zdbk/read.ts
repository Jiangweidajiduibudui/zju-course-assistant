import { z } from "zod";
import type { SnapshotData } from "../../shared/contracts/catalog.js";
import { fail } from "../errors.js";
import {
  assemble,
  ChosenRow,
  CourseRow,
  normalizeTerm,
  type RawSection,
  SectionRow,
  termId,
  WeekRows,
} from "./normalize.js";
import type { PageContext, SchoolSession } from "./session.js";

export interface SchoolDriver {
  status(): {
    state: "logged_out" | "logging_in" | "authenticated" | "expired";
    checkedAt: string;
  };
  login(signal: AbortSignal): Promise<void>;
  terms(): ReturnType<typeof normalizeTerm>[];
  snapshot(
    id: string,
    signal: AbortSignal,
    progress: (phase: string, completed: number, total: number | null) => void,
  ): Promise<SnapshotData>;
  committed(): void;
  clearBinding(): void;
  logout(): Promise<void>;
  close(): Promise<void>;
}
export class LiveSchool implements SchoolDriver {
  private pendingContext: PageContext | null = null;
  constructor(
    private session: Pick<
      SchoolSession,
      | "status"
      | "login"
      | "cachedContext"
      | "read"
      | "context"
      | "assertScope"
      | "scope"
      | "bind"
      | "clearBinding"
      | "logout"
      | "close"
    >,
  ) {}
  status() {
    return this.session.status();
  }
  async login(signal: AbortSignal) {
    await this.session.login(signal);
  }
  terms() {
    const data = this.session.cachedContext();
    return data ? [normalizeTerm(data)] : [];
  }
  private async json<T extends z.ZodType>(
    name: Parameters<SchoolSession["read"]>[0],
    body: Record<string, string>,
    schema: T,
    signal: AbortSignal,
  ): Promise<z.infer<T>> {
    const raw = await this.session.read(name, body, signal);
    try {
      return schema.parse(JSON.parse(raw));
    } catch {
      return fail(
        "UPSTREAM_SCHEMA_CHANGED",
        "教务字段结构发生变化，未发布快照。",
      );
    }
  }
  async snapshot(
    id: string,
    signal: AbortSignal,
    progress: (phase: string, completed: number, total: number | null) => void,
  ) {
    this.pendingContext = null;
    const context = await this.session.context(signal);
    this.session.assertScope(context);
    if (termId(context) !== id)
      return fail(
        "SESSION_SCOPE_CHANGED",
        "学校当前选课学期与所选学期不同，请切换到当前学期。",
      );
    const body = { xn: context.year, xq: context.code };
    const params = {
      xnxq: `(${context.year}-${context.code})-`,
      cx_ylcx: "0",
      "cxtjList[0].cxlb": "kcmc",
      "cxtjList[0].cxgx": "like",
      "cxtjList[0].cxnr": "",
    };
    const weeks = (await this.json("weeks", body, WeekRows, signal)).result;
    const chosen = await this.json(
      "chosen",
      body,
      z.array(ChosenRow).max(1000),
      signal,
    );
    const rows: z.infer<typeof CourseRow>[] = [];
    const seen = new Set<string>();
    let queries = 0;
    const discover = async (prefix: string): Promise<void> => {
      const excluded: string[] = [];
      while (true) {
        if (signal.aborted) return fail("SYNC_INCOMPLETE", "同步已取消。");
        if (++queries > 5000 || prefix.length > 64)
          return fail("SYNC_INCOMPLETE", "目录查询超过预算，未发布截断快照。");
        const search: Record<string, string> = {
          ...params,
          cx_zbgx: "and",
          kspage: "1",
          jspage: "50",
          "cxtjList[0].cxlb": "kcdm",
          "cxtjList[0].cxgx": "leftlike",
          "cxtjList[0].cxnr": prefix,
        };
        for (const [index, value] of excluded.entries()) {
          search[`cxtjList[${index + 1}].cxlb`] = "kcdm";
          search[`cxtjList[${index + 1}].cxgx`] = "notleftlike";
          search[`cxtjList[${index + 1}].cxnr`] = value;
        }
        const result = await this.json(
          "courses",
          search,
          z.array(CourseRow).max(50),
          signal,
        );
        if (
          result.some(
            (row, index) =>
              Number(row.rn) !== index + 1 ||
              !/^[A-Za-z0-9-]+$/.test(row.kcdm) ||
              !row.kcdm.startsWith(prefix) ||
              excluded.some((p) => row.kcdm.startsWith(p)),
          )
        )
          return fail(
            "SYNC_INCOMPLETE",
            "目录细分查询语义或课程代码结构发生变化，未发布快照。",
          );
        if (new Set(result.map((row) => row.kcdm)).size !== result.length)
          return fail("SYNC_INCOMPLETE", "目录查询返回重复课程，未发布快照。");
        // Current search explicitly caps each result at 50. A saturated query is
        // subdivided; an empty next rank page would falsely imply completeness.
        if (result.length < 50) {
          for (const row of result) {
            if (seen.has(row.kcdm))
              return fail(
                "SYNC_INCOMPLETE",
                "目录分区出现重复课程，未发布快照。",
              );
            seen.add(row.kcdm);
            rows.push(row);
          }
          if (rows.length > 50000)
            return fail("SYNC_INCOMPLETE", "目录超过支持范围，未截断发布。");
          progress("细分查询完整课程目录", rows.length, null);
          return;
        }
        const children = [
          ...new Set(result.map((row) => row.kcdm.slice(0, prefix.length + 1))),
        ];
        for (const child of children) {
          if (child.length <= prefix.length)
            return fail(
              "SYNC_INCOMPLETE",
              "目录分区无法进一步细分，未发布快照。",
            );
          await discover(child);
          excluded.push(child);
        }
        // Query the complement as well: the observed first page does not prove
        // that the discovered code prefixes cover every course in this partition.
      }
    };
    await discover("");
    const requests = new Map(
      rows.map((row) => [row.kcdm, { kcdm: row.kcdm, xkkh: row.xkkh }]),
    );
    // Enrolled courses may be absent from the current selectable directory.
    // Their chosen records remain the baseline; missing detail stays unknown.
    // The observed detail endpoint errors for those out-of-catalog selectors.
    const details = new Map<string, RawSection[]>();
    let completed = 0;
    // Bound concurrent read load. Settle the whole batch before reporting failure,
    // so no late sibling request can overwrite a terminal job or publish partial data.
    const entries = [...requests.values()];
    for (let offset = 0; offset < entries.length; offset += 3) {
      if (signal.aborted) return fail("SYNC_INCOMPLETE", "同步已取消。");
      const batch = entries.slice(offset, offset + 3);
      const results = await Promise.allSettled(
        batch.map((row) =>
          this.json(
            "sections",
            {
              ...params,
              ...body,
              dl: "xk_9",
              kcdm: row.kcdm,
              xkkh: row.xkkh,
              ylxs: context.quotaDisplay,
            },
            z.array(SectionRow).max(10000),
            signal,
          ),
        ),
      );
      for (const [index, result] of results.entries()) {
        if (result.status === "rejected") throw result.reason;
        const row = batch[index];
        if (!row) return fail("SYNC_INCOMPLETE", "教学班批次不完整。");
        if (
          new Set(result.value.map((s) => s.xkkh)).size !== result.value.length
        )
          return fail("SYNC_INCOMPLETE", "教学班重复，未发布快照。");
        details.set(row.kcdm, result.value);
        progress("读取教学班与锁定基线", ++completed, requests.size);
      }
    }
    // Pin the principal/term and confirm the enrolled baseline did not change mid-read.
    const finalContext = await this.session.context(signal);
    this.session.assertScope(finalContext);
    if (
      this.session.scope(context) !== this.session.scope(finalContext) ||
      termId(finalContext) !== id
    )
      return fail(
        "SESSION_SCOPE_CHANGED",
        "读取期间账号或学期变化，未发布快照。",
      );
    const finalChosen = await this.json(
      "chosen",
      body,
      z.array(ChosenRow).max(1000),
      signal,
    );
    const signature = (items: z.infer<typeof ChosenRow>[]) =>
      JSON.stringify(
        items
          .map((r) => ({
            section: r.xkkh,
            course: r.kcdm,
            status: r.sxbj,
            priority: r.xkzy,
          }))
          .sort((a, b) => a.section.localeCompare(b.section)),
      );
    if (signature(chosen) !== signature(finalChosen))
      return fail("SYNC_INCOMPLETE", "读取期间已选状态变化，请重新同步。");
    const snapshot = assemble(
      context,
      weeks,
      rows,
      details,
      chosen,
      new Date().toISOString(),
    );
    this.pendingContext = context;
    return snapshot;
  }
  committed() {
    if (this.pendingContext) this.session.bind(this.pendingContext);
    this.pendingContext = null;
  }
  clearBinding() {
    this.pendingContext = null;
    this.session.clearBinding();
  }
  logout() {
    return this.session.logout();
  }
  close() {
    return this.session.close();
  }
}
