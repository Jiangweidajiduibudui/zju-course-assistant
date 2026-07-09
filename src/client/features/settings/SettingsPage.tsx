import { type FormEvent, useEffect, useState } from "react";
import type { Session } from "../../../shared/contracts/index.js";

/**
 * 设置页（组员 E；docs/08 §5.1）。
 *
 * 定位：隐私同意说明、LLM 端点配置（FR-10 向导入口）、学分上限、数据清除。
 * 边界：key 只存客户端（明文风险提示 + 掩码显示 + 一键删除，D11）；
 *      永不持久化到服务端；学分上限是生成推荐的必填前置（D38）。
 * 成功判据：AC-10.x、AC-11.3；E2E key 生命周期用例（docs/05 §5.1）。
 *
 * TODO(Task 5, 组员 E): LLM 端点配置向导（厂商预设 + 能力检测，D10/D22）。
 */
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

  useEffect(() => {
    setCreditLimitInput(session?.rules.creditLimit?.toString() ?? "");
    setError(null);
  }, [session]);

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
      <h2 className="text-lg font-bold">设置（Task 2/5 交付）</h2>

      <div className="rounded-lg border bg-white p-4">
        <h3 className="font-semibold">LLM 端点配置（占位）</h3>
        <p className="mt-2 text-sm text-gray-600">
          当前不会收集或保存 API key，推荐生成、评价摘要、偏好理解和解释仍保持禁用。
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600">
          <li>后续接入同源 Fastify 代理后，再做端点能力检测。</li>
          <li>key 只随单次请求进入后端内存，不落库、不写日志、不进入提示词。</li>
          <li>正式配置页需要提示费用风险与长时间等待风险。</li>
        </ul>
        <button
          type="button"
          disabled
          className="mt-3 rounded border border-gray-300 px-3 py-2 text-sm text-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100"
        >
          配置 LLM（等待 Task 4）
        </button>
      </div>

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
            尚未创建 session。请先在“导入/导出”加载合成 Demo 数据。
          </p>
        )}
      </div>

      <button
        type="button"
        className="rounded border border-red-600 px-3 py-1 text-red-600"
        onClick={() => void onClearAllLocalData()}
      >
        清除全部本地数据（AC-11.3）
      </button>
    </section>
  );
}
