import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import { Button, Modal } from "./ui.js";

export function SchoolConnection() {
  const { api, info, refreshInfo } = useWorkspace();
  const client = useQueryClient();
  const [open, setOpen] = useState(false),
    [jobId, setJobId] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const handled = useRef("");
  const session = useQuery({
    queryKey: ["school", "session"],
    enabled: api instanceof HttpWorkspace,
    queryFn: () => {
      if (!(api instanceof HttpWorkspace)) throw new Error("本机服务不可用");
      return api.request("getSession");
    },
    refetchInterval: open ? 3000 : false,
  });
  const job = useQuery({
    queryKey: ["school", "job", jobId],
    enabled: !!jobId && api instanceof HttpWorkspace,
    queryFn: () => {
      if (!(api instanceof HttpWorkspace)) throw new Error("本机服务不可用");
      return api.request("getJob", { jobId });
    },
    refetchInterval: (query) =>
      query.state.data &&
      ["queued", "running"].includes(query.state.data.status)
        ? 1000
        : false,
  });
  useEffect(() => {
    const result = job.data;
    if (!result || result.status === "queued" || result.status === "running")
      return;
    if (handled.current === result.id) return;
    handled.current = result.id;
    if (result.status === "failed") setMessage(result.error.message);
    if (result.status === "cancelled")
      setMessage("任务已取消，原有快照与计划保持不变。");
    if (result.status === "succeeded") {
      setMessage(
        result.kind === "login"
          ? "登录成功。选择当前学期后，可同步完整课程目录。"
          : "完整快照已保存。已有计划需先对账，新计划可直接使用最新数据。",
      );
      void (async () => {
        if (!(api instanceof HttpWorkspace)) return;
        const terms = await api.request("listTerms");
        const target =
          result.kind === "login" ? terms.items[0]?.id : info.termId;
        await refreshInfo(target);
        await client.invalidateQueries({ queryKey: ["workspace"] });
        await client.invalidateQueries({ queryKey: ["school", "session"] });
      })().catch((e: Error) => setMessage(e.message));
    }
  }, [job.data, api, client, refreshInfo, info.termId]);
  if (!(api instanceof HttpWorkspace)) return null;
  const running =
    busy || job.data?.status === "queued" || job.data?.status === "running";
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    void work()
      .catch((e: Error) => setMessage(e.message))
      .finally(() => setBusy(false));
  };
  const label =
    session.data?.state === "authenticated"
      ? "教务已登录"
      : session.data?.state === "expired"
        ? "教务会话待验证"
        : session.data?.state === "logging_in"
          ? "等待学校登录"
          : "连接教务";
  return (
    <>
      <Button onClick={() => setOpen(true)}>{label}</Button>
      {open && (
        <Modal title="教务连接与同步" close={() => setOpen(false)}>
          <p>在学校窗口完成登录后，同步当前学期课程。</p>
          <p className="muted">
            {label} · 当前学期：{info.termLabel}
          </p>
          <div className="toolbar-actions">
            <Button
              disabled={running}
              onClick={() =>
                run(async () => {
                  const result = await api.request("startLogin", {}, {}, {});
                  setJobId(result.id);
                })
              }
            >
              打开学校登录窗口
            </Button>
            <Button
              className="primary-button"
              disabled={
                running || !info.termId || session.data?.state === "logged_out"
              }
              onClick={() =>
                run(async () => {
                  const result = await api.request(
                    "startSync",
                    {},
                    {},
                    { termId: info.termId },
                  );
                  setJobId(result.id);
                })
              }
            >
              同步当前学期
            </Button>
            <Button
              disabled={running || session.data?.state === "logged_out"}
              onClick={() =>
                run(async () => {
                  await api.request("logout", {}, {}, {});
                  await session.refetch();
                  setMessage("学校登录已清除，规划数据仍保存在本机。");
                })
              }
            >
              清除学校登录
            </Button>
          </div>
          {job.data &&
            (job.data.status === "queued" || job.data.status === "running") && (
              <div role="status" className="notice">
                <p>
                  {job.data.phase} · {job.data.completedUnits}
                  {job.data.totalUnits === null
                    ? ""
                    : ` / ${job.data.totalUnits}`}
                </p>
                <Button
                  onClick={() =>
                    run(async () => {
                      await api.request("cancelJob", { jobId }, {}, {});
                      await job.refetch();
                    })
                  }
                >
                  取消任务
                </Button>
                <p className="muted">同步期间可关闭面板继续规划。</p>
              </div>
            )}
          {(message || job.error || session.error) && (
            <p role="status" className="notice">
              {message || job.error?.message || session.error?.message}
            </p>
          )}
          <Button
            onClick={() => {
              setOpen(false);
            }}
          >
            返回工作台
          </Button>
        </Modal>
      )}
    </>
  );
}
