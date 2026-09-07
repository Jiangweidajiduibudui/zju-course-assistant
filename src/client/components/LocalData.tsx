import { useState } from "react";
import type { z } from "zod";
import type { ImportPreview } from "../../shared/contracts/operations.js";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import { Button, Modal } from "./ui.js";
export function LocalData() {
  const { api, info, refreshInfo } = useWorkspace();
  const [preview, setPreview] = useState<z.infer<typeof ImportPreview> | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");
  if (!(api instanceof HttpWorkspace)) return null;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "操作失败。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="local-data">
      <summary data-tour="local-data">本机数据与备份</summary>
      <p className="muted">
        保存于 {info.dataDirectory}。导入先预览，确认后添加为新计划。
      </p>
      <label className="form-label">
        导入归档（JSON）
        <input
          type="file"
          accept="application/json,.json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > 64 * 1024 * 1024)
                throw new Error("文件超过 64 MiB。");
              setPreview(
                await api.previewImport(JSON.parse(await file.text())),
              );
              setKey(crypto.randomUUID());
            });
          }}
        />
      </label>
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const archive = await api.exportArchive();
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(archive, null, 2)], {
                type: "application/json",
              }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "zju-planning-v2.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            setMessage("已导出规划归档，不含登录会话或模型凭据。");
          })
        }
      >
        导出全部规划备份
      </Button>
      {message && <p role="status">{message}</p>}
      {preview && (
        <Modal
          title="确认导入归档"
          close={() => {
            if (!busy) setPreview(null);
          }}
        >
          <p>
            {preview.snapshotCount} 个快照，{preview.planCount} 个计划。
          </p>
          <ul>
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <Button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.applyImport(
                  preview.id,
                  preview.expectedDataRevision,
                  key,
                );
                setPreview(null);
                await refreshInfo();
                setMessage("已添加为新计划，原数据保留。");
              })
            }
          >
            确认添加为新计划
          </Button>
          {message && <p role="alert">{message}</p>}
        </Modal>
      )}
    </details>
  );
}
