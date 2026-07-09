import { Eye, EyeOff, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Session } from "../../../shared/contracts/index.js";
import { db } from "../../app/db";

/**
 * 设置页（组员 E；docs/08 §5.1）。
 *
 * 定位：LLM 端点配置（FR-10 向导入口）、学分上限、数据清除。
 * 边界：key 只存客户端 Dexie kv（明文风险提示 + 掩码显示 + 一键删除，D11/H6）；
 *      永不持久化到服务端；学分上限是生成推荐的必填前置（D38）。
 */
const KV_LLM_ENDPOINT = "llm.endpoint";
const KV_LLM_KEY = "llm.key";
const KV_LLM_MODEL = "llm.model";

interface SettingsPageProps {
  session: Session | null;
  onUpdateCreditLimit: (creditLimit: number) => void | Promise<void>;
  onClearAllLocalData: () => void | Promise<void>;
}

export function SettingsPage({
  session,
  onUpdateCreditLimit,
  onClearAllLocalData,
}: SettingsPageProps) {
  const [creditLimitInput, setCreditLimitInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);

  useEffect(() => {
    async function load() {
      const [endpoint, key, model] = await Promise.all([
        db.kv.get(KV_LLM_ENDPOINT),
        db.kv.get(KV_LLM_KEY),
        db.kv.get(KV_LLM_MODEL),
      ]);
      if (endpoint?.value) setLlmEndpoint(String(endpoint.value));
      if (key?.value) {
        setLlmKey(String(key.value));
        setLlmSaved(true);
      }
      if (model?.value) setLlmModel(String(model.value));
    }
    void load();
  }, []);

  useEffect(() => {
    setCreditLimitInput(session?.rules.creditLimit?.toString() ?? "");
    setError(null);
  }, [session]);

  const handleSaveLLM = useCallback(async () => {
    await Promise.all([
      db.kv.put({ key: KV_LLM_ENDPOINT, value: llmEndpoint }),
      db.kv.put({ key: KV_LLM_KEY, value: llmKey }),
      db.kv.put({ key: KV_LLM_MODEL, value: llmModel }),
    ]);
    setLlmSaved(true);
  }, [llmEndpoint, llmKey, llmModel]);

  const handleDeleteLLMKey = useCallback(async () => {
    await db.kv.delete(KV_LLM_KEY);
    setLlmKey("");
    setLlmSaved(false);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const creditLimit = Number(creditLimitInput);
    if (!Number.isFinite(creditLimit) || creditLimit <= 0) {
      setError("请输入大于 0 的学分上限");
      return;
    }
    await onUpdateCreditLimit(creditLimit);
    setError(null);
  }

  return (
    <section className="page-shell max-w-[760px] page-stack" aria-labelledby="settings-heading">
      <div>
        <h1 id="settings-heading" className="text-2xl font-semibold tracking-[-0.015em] text-ink">
          设置
        </h1>
        <p className="mt-2 max-w-[65ch] text-[13.5px] leading-6 text-ink-muted">
          管理 LLM 端点、学分上限和本地数据。key 仅保存在浏览器本地，不落服务端。
        </p>
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[16px] font-semibold text-ink">LLM 端点配置</h2>
              <span className="pill pill-warn px-2.5 py-1">本地明文</span>
            </div>
            <p className="mt-3 max-w-[64ch] text-[13.5px] leading-6 text-ink-muted">
              key 仅存储在浏览器本地（Dexie IndexedDB），不落服务端、不写日志、不进提示词（H6/D40）。
              不配置亦可使用基本功能；AI 排序与评价摘要需要 key。
            </p>
          </div>
          {llmSaved ? <span className="pill pill-ok px-2.5 py-1">已保存</span> : null}
        </div>

        <div className="mt-5 grid gap-4">
          <label className="grid gap-2 text-[13px] font-semibold text-ink-body">
            API 端点 URL
            <input
              type="url"
              placeholder="https://api.openai.com/v1"
              value={llmEndpoint}
              onChange={(event) => setLlmEndpoint(event.target.value)}
              className="input-field px-3 py-2.5 text-[14px]"
            />
          </label>

          <label className="grid gap-2 text-[13px] font-semibold text-ink-body">
            模型名称
            <input
              type="text"
              placeholder="gpt-4o"
              value={llmModel}
              onChange={(event) => setLlmModel(event.target.value)}
              className="input-field px-3 py-2.5 text-[14px]"
            />
          </label>

          <label className="grid gap-2 text-[13px] font-semibold text-ink-body">
            API Key
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-…"
                value={llmKey}
                onChange={(event) => {
                  setLlmKey(event.target.value);
                  setLlmSaved(false);
                }}
                className="input-field min-w-0 flex-1 px-3 py-2.5 text-[14px]"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="icon-button h-11 min-w-11"
                title={showKey ? "隐藏 key" : "显示 key"}
                aria-label={showKey ? "隐藏 key" : "显示 key"}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                type="button"
                onClick={handleDeleteLLMKey}
                disabled={!llmKey}
                className="icon-button h-11 min-w-11 text-danger"
                title="删除 key"
                aria-label="删除 key"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={handleSaveLLM} className="primary-button px-4 py-2.5">
              保存 LLM 配置
            </button>
            {llmSaved ? <span className="text-[13px] text-ok">✓ 已保存（明文存储在浏览器本地）</span> : null}
          </div>
        </div>

        <div className="mt-5 rounded-[12px] border border-warn-border bg-warn-bg p-3 text-[12.5px] leading-5 text-warn">
          ⚠️ Key 以明文存储在浏览器 IndexedDB 中。请勿在公共或共享设备上使用。
          后续版本将接入同源 Fastify 代理完成能力检测（D10/D22）。
        </div>
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[16px] font-semibold text-ink">学分上限（D38）</h2>
          {session?.rules.creditLimit === null ? (
            <span className="pill pill-warn px-2.5 py-1">尚未填写</span>
          ) : session ? (
            <span className="pill pill-ok px-2.5 py-1">已保存</span>
          ) : (
            <span className="pill pill-neutral px-2.5 py-1">等待 session</span>
          )}
        </div>

        {session ? (
          <form className="mt-4 grid gap-4" onSubmit={handleSubmit}>
            <p className="text-[13.5px] text-ink-muted">当前 session：{session.name}</p>
            <label className="grid max-w-[220px] gap-2 text-[13px] font-semibold text-ink-body">
              学分上限
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={creditLimitInput}
                onChange={(event) => setCreditLimitInput(event.target.value)}
                className="input-field px-3 py-2.5 font-mono text-[14px]"
              />
            </label>
            {error ? (
              <p className="rounded-[10px] border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className="primary-button px-4 py-2.5">
                保存学分上限
              </button>
              {session.rules.creditLimit === null ? (
                <p className="text-[13px] text-warn">尚未填写学分上限，不能生成推荐。</p>
              ) : (
                <p className="text-[13px] text-ok">已保存学分上限：{session.rules.creditLimit}</p>
              )}
            </div>
            <p className="text-[12.5px] leading-5 text-ink-faint">
              本切片只保存规则栏状态；是否可生成推荐仍由后续 selection-model 终校验决定。
            </p>
          </form>
        ) : (
          <p className="mt-4 rounded-[12px] bg-paper-deep p-4 text-[13.5px] leading-6 text-ink-muted">
            尚未创建 session。请先在“导入/导出”加载合成 Demo 数据。
          </p>
        )}
      </div>

      <div className="rounded-[16px] border border-danger-border bg-danger-bg p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-danger">数据清除（AC-11.3）</h2>
            <p className="mt-2 max-w-[60ch] text-[13px] leading-6 text-danger">
              清除后回到隐私同意页，需重新同意。此操作只清除本地 IndexedDB 数据，不访问 zdbk。
            </p>
          </div>
          <button
            type="button"
            className="danger-button px-4 py-2.5"
            onClick={() => void onClearAllLocalData()}
          >
            清除全部本地数据（AC-11.3）
          </button>
        </div>
      </div>
    </section>
  );
}
