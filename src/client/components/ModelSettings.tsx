import { useEffect, useState } from "react";
import type { z } from "zod";
import type { Settings } from "../../shared/contracts/operations.js";
import { useWorkspace } from "../data/context.js";
import { HttpWorkspace } from "../data/http.js";
import { useUi } from "../ui-store.js";
import { Button, Modal } from "./ui.js";

export function ModelSettings() {
  const { api } = useWorkspace();
  const ui = useUi();
  const [settings, setSettings] = useState<z.infer<typeof Settings> | null>(
    null,
  );
  const [url, setUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-v4-flash");
  const [key, setKey] = useState("");
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!ui.modelSettingsOpen || !(api instanceof HttpWorkspace)) return;
    let active = true;
    setBusy(true);
    setMessage("");
    setKey("");
    void api
      .request("getSettings")
      .then(async (value) => {
        const endpoint = value.content.endpoints[0];
        const status = endpoint
          ? await api.request("getCredentialStatus", {
              endpointId: endpoint.id,
            })
          : null;
        if (!active) return;
        setSettings(value);
        setEnabled(endpoint ? value.content.llmEnabled : true);
        setUrl(endpoint?.baseUrl ?? "https://api.deepseek.com");
        setModel(endpoint?.model ?? "deepseek-v4-flash");
        setConfigured(status?.configured ?? false);
      })
      .catch((e: Error) => {
        if (active) setMessage(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, ui.modelSettingsOpen]);
  if (!(api instanceof HttpWorkspace)) return null;
  const close = () => {
    if (busy) return;
    setKey("");
    ui.set({ modelSettingsOpen: false });
  };
  return (
    <>
      <Button onClick={() => ui.set({ modelSettingsOpen: true })}>
        模型设置
      </Button>
      {ui.modelSettingsOpen && (
        <Modal title="模型设置" close={close}>
          <p className="muted">连接你使用的模型服务。</p>
          <Button
            disabled={busy}
            onClick={() => {
              setUrl("https://api.deepseek.com");
              setModel("deepseek-v4-flash");
              setKey("");
              setMessage(
                "已填入 DeepSeek 官方默认配置。请填写 DeepSeek 的 API key；其他服务商的 key 不会被迁移。",
              );
            }}
          >
            使用 DeepSeek 官方配置
          </Button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!settings) return;
              setBusy(true);
              setMessage("");
              void (async () => {
                const old = settings.content.endpoints[0];
                const value = await api.request(
                  "updateSettings",
                  {},
                  {},
                  {
                    expectedRevision: settings.revision,
                    content: {
                      ...settings.content,
                      llmEnabled: enabled,
                      endpoints: [
                        {
                          id: old?.id ?? null,
                          label: old?.label ?? "我的模型",
                          baseUrl: url.trim(),
                          model: model.trim(),
                        },
                        ...settings.content.endpoints.slice(1).map((e) => ({
                          id: e.id,
                          label: e.label,
                          baseUrl: e.baseUrl,
                          model: e.model,
                        })),
                      ],
                    },
                  },
                );
                setSettings(value);
                const endpoint = value.content.endpoints[0];
                if (!endpoint) throw new Error("模型配置未保存。");
                api.modelEndpointId = endpoint.id;
                const status = await api.request(
                  key.trim() ? "putCredential" : "getCredentialStatus",
                  { endpointId: endpoint.id },
                  {},
                  key.trim() ? { apiKey: key.trim() } : null,
                );
                setKey("");
                setConfigured(status.configured);
                api.modelConfigured = enabled && status.configured;
                setMessage(
                  !enabled
                    ? "配置已保存，模型功能已关闭。"
                    : status.configured
                      ? "已保存并启用，可以返回候选清单解析偏好或排课。尚未发送模型请求。"
                      : "地址与模型已保存，请填写 API key 后启用。修改地址或模型后需重新填写 key。",
                );
              })()
                .catch((e: Error) => setMessage(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label className="form-label">
              Base URL
              <input
                aria-label="模型接口地址"
                type="url"
                required
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <p className="muted">
              填写服务商 Base URL（如 https://api.deepseek.com 或带 /v1
              的地址），应用自动补齐 Chat Completions 路径；也兼容完整接口地址。
            </p>
            <label className="form-label">
              模型名称
              <input
                aria-label="模型名称"
                required
                value={model}
                disabled={busy}
                onChange={(e) => setModel(e.target.value)}
              />
            </label>
            <label className="form-label">
              API key
              <input
                aria-label="API key"
                type="password"
                autoComplete="off"
                value={key}
                disabled={busy}
                placeholder={
                  configured ? "本次运行已配置；留空保留" : "粘贴你的 API key"
                }
                onChange={(e) => setKey(e.target.value)}
              />
            </label>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={enabled}
                disabled={busy}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              启用模型功能
            </label>
            {message && (
              <p role="status" className="notice">
                {message}
              </p>
            )}
            <div className="toolbar-actions">
              <Button
                type="submit"
                className="primary-button"
                disabled={busy || !settings}
              >
                {busy ? "正在保存…" : enabled ? "保存并启用" : "保存设置"}
              </Button>
              <Button type="button" disabled={busy} onClick={close}>
                返回工作台
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
