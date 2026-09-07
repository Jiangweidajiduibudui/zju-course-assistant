import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { Job } from "../../shared/contracts/operations.js";
import { fail, ServiceError } from "../errors.js";
import type { Store } from "../storage/store.js";
import type { SchoolDriver } from "./read.js";

const at = () => new Date().toISOString();
export class SchoolJobs {
  private resetting = false;
  private active: {
    id: string;
    controller: AbortController;
    work: Promise<void>;
  } | null = null;
  constructor(
    private store: Store,
    readonly driver: SchoolDriver,
  ) {}
  get(id: string) {
    return (
      this.store.get("school-job", id, Job) ??
      fail("NOT_FOUND", "登录或同步任务不存在。")
    );
  }
  private put<T extends z.infer<typeof Job>>(value: T) {
    this.store.put("school-job", value.id, Job.parse(value));
    return value;
  }
  start(kind: "login" | "sync", termId?: string) {
    if (this.active || this.resetting)
      return fail(
        "OPERATION_IN_PROGRESS",
        "已有登录或同步任务运行，请等待或取消。",
      );
    if (kind === "sync" && this.driver.status().state === "logged_out")
      return fail("SESSION_REQUIRED", "请先登录教务系统。");
    const id = `school-job-${randomUUID()}`,
      controller = new AbortController();
    const job = this.put({
      id,
      kind,
      status: "queued",
      phase: kind === "login" ? "打开学校登录窗口" : "准备同步",
      completedUnits: 0,
      totalUnits: null,
      createdAt: at(),
    });
    const active = { id, controller, work: Promise.resolve() };
    this.active = active;
    active.work = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        const signal = controller.signal;
        if (signal.aborted) return;
        this.put({ ...job, status: "running" });
        if (kind === "login") {
          await this.driver.login(signal);
          if (!signal.aborted)
            this.put({
              id,
              kind,
              status: "succeeded",
              session: this.driver.status(),
              finishedAt: at(),
            });
        } else {
          const snapshot = await this.driver.snapshot(
            termId ?? "",
            signal,
            (phase, completedUnits, totalUnits) => {
              if (!signal.aborted)
                this.put({
                  ...job,
                  status: "running",
                  phase,
                  completedUnits,
                  totalUnits,
                });
            },
          );
          if (signal.aborted) return;
          // Scope binding is private and conservative: failed DB publication may leave
          // the same account bound, but never allows cross-account snapshot mixing.
          this.driver.committed();
          this.store.transaction(() => {
            this.store.insertSnapshot(snapshot);
            this.store.bump();
            this.put({
              id,
              kind,
              status: "succeeded",
              snapshotId: snapshot.meta.id,
              finishedAt: at(),
            });
          });
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        const e =
          error instanceof ServiceError
            ? error
            : new ServiceError(
                "UPSTREAM_SCHEMA_CHANGED",
                "读取结果未通过完整性校验，旧快照保持不变。",
              );
        this.put({
          id,
          kind,
          status: "failed",
          error: {
            code: e.code,
            message: e.message,
            retryable: e.retryable,
            fields: [],
          },
          finishedAt: at(),
        });
      })
      .finally(() => {
        if (this.active === active) this.active = null;
      });
    return job;
  }
  cancel(id: string) {
    const job = this.get(id);
    if (job.status !== "queued" && job.status !== "running") return job;
    if (this.active?.id === id) this.active.controller.abort();
    return this.put({
      id,
      kind: job.kind,
      status: "cancelled",
      error: null,
      finishedAt: at(),
    });
  }
  cancelAll() {
    if (this.active) this.cancel(this.active.id);
  }
  async logout() {
    this.resetting = true;
    try {
      this.cancelAll();
      await this.active?.work;
      await this.driver.logout();
      return this.driver.status();
    } finally {
      this.resetting = false;
    }
  }
  async close() {
    this.resetting = true;
    try {
      this.cancelAll();
      await this.active?.work;
      await this.driver.close();
    } finally {
      this.resetting = false;
    }
  }
}
