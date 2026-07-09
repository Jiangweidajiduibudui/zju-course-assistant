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
 * 成功判据：E2E key 生命周期用例（docs/05 §5.1）。
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

  // LLM config
  const [llmEndpoint, setLlmEndpoint] = useState("");
  const [llmKey, setLlmKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);

  // Load saved LLM config from Dexie
  useEffect(() => {
    async function load() {
      const [ep, key, model] = await Promise.all([
        db.kv.get(KV_LLM_ENDPOINT),
        db.kv.get(KV_LLM_KEY),
        db.kv.get(KV_LLM_MODEL),
      ]);
      if (ep?.value) setLlmEndpoint(String(ep.value));
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
    <section className="space-y-5 p-6">
      <h2 className="text-lg font-bold">设置</h2>

      {/* LLM endpoint config */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="font-semibold">LLM 端点配置</h3>
        <p className="mt-1 text-xs text-gray-500">
          key 仅存储在浏览器本地（Dexie IndexedDB），不落服务端、不写日志、不进提示词（H6/D40）。
          不配置亦可使用基本功能；AI 排序与评价摘要需要 key。
        </p>

        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-sm font-medium text-gray-700">API 端点 URL</span>
            <input
              type="url"
              placeholder="https://api.openai.com/v1"
              value={llmEndpoint}
              onChange={(e) => setLlmEndpoint(e.target.value)}
              className="mt-1 block w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">模型名称</span>
            <input
              type="text"
              placeholder="gpt-4o"
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              className="mt-1 block w-full max-w-md rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium text-gray-700">API Key</span>
            <div className="mt-1 flex max-w-md gap-2">
              <input
                type={showKey ? "text" : "password"}
                placeholder="sk-…"
                value={llmKey}
                onChange={(e) => {
                  setLlmKey(e.target.value);
                  setLlmSaved(false);
                }}
                className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="rounded border border-gray-300 p-2 text-gray-500 hover:bg-gray-50"
                title={showKey ? "隐藏 key" : "显示 key"}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                type="button"
                onClick={handleDeleteLLMKey}
                disabled={!llmKey}
                className="rounded border border-red-300 p-2 text-red-500 hover:bg-red-50 disabled:opacity-30"
                title="删除 key"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleSaveLLM}
              className="rounded bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
            >
              保存 LLM 配置
            </button>
            {llmSaved && (
              <span className="self-center text-xs text-emerald-600">
                ✓ 已保存（明文存储在浏览器本地）
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 rounded bg-amber-50 p-2 text-xs text-amber-700">
          ⚠️ 注意：Key 以明文存储在浏览器 IndexedDB 中。请勿在公共或共享设备上使用。
          后续版本将接入同源 Fastify 代理完成能力检测（D10/D22）。
        </div>
      </div>

      {/* Credit limit */}
      <div className="rounded-lg border bg-white p-4">
        <h3 className="font-semibold">学分上限（D38）</h3>
        {session ? (
          <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
            <p className="text-sm text-gray-600">当前 session：{session.name}</p>
            <label className="block text-sm font-medium text-gray-700">
              学分上限
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={creditLimitInput}
                onChange={(event) => setCreditLimitInput(event.target.value)}
                className="mt-1 block w-40 rounded border border-gray-300 px-3 py-2"
              />
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <button type="submit" className="rounded bg-blue-600 px-3 py-2 text-sm text-white">
              保存学分上限
            </button>
            {session.rules.creditLimit === null ? (
              <p className="text-sm text-amber-700">尚未填写学分上限，不能生成推荐。</p>
            ) : (
              <p className="text-sm text-emerald-700">
                已保存学分上限：{session.rules.creditLimit}
              </p>
            )}
            <p className="text-xs text-gray-500">
              本切片只保存规则栏状态；是否可生成推荐仍由后续 selection-model 终校验决定。
            </p>
          </form>
        ) : (
          <p className="mt-2 text-sm text-gray-600">
            尚未创建 session。请先在"导入/导出"加载合成 Demo 数据。
          </p>
        )}
      </div>

      <button
        type="button"
        className="rounded border border-red-600 px-3 py-1 text-sm text-red-600"
        onClick={() => void onClearAllLocalData()}
      >
        清除全部本地数据（AC-11.3）
      </button>
    </section>
  );
}
