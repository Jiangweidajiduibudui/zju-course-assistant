import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { db } from "../../app/db";

/**
 * 首次引导 + 隐私同意闸门（组员 E；FR-11、D23）。
 *
 * 铁律：未同意前无任何功能可用（AC-11.1）；正式文案必须覆盖 D04 全部要点
 * （AC-11.2）：客户端存储 / 导入数据提交后端处理 / chalaoshi 后端抓取 /
 * LLM 可能发送完整课表、偏好、对话 / 第三方供应商可能保存请求数据 /
 * 姓名、学号、Cookie、令牌、key 永不进入提示词。
 *
 * TODO(Task 5, 组员 E): 替换占位文案为经产品负责人确认的正式隐私声明。
 */
const CONSENT_KEY = "privacy-consent.v1";

export function ConsentGate({ children }: { children: ReactNode }) {
  // useLiveQuery 默认初始值也是 undefined；而 kv.get 不存在时也会返回 undefined。
  // 用 null 作为加载态哨兵，避免首次用户永远停在“加载中…”。
  const consent = useLiveQuery(() => db.kv.get(CONSENT_KEY), [], null);

  if (consent === null) {
    return <p className="p-8 text-gray-500">加载中…</p>;
  }

  if (!consent) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="mb-4 text-xl font-bold">首次使用：隐私声明（占位）</h1>
        <p className="mb-4 text-sm text-gray-600">
          ⚠️ 脚手架占位文案 —— 正式隐私声明在 Task 5 由产品负责人确认后替换， 必须覆盖 D04
          全部要点。不同意则无法进入产品（D23）。
        </p>
        <button
          type="button"
          className="rounded bg-blue-600 px-4 py-2 text-white"
          onClick={() =>
            db.kv.put({ key: CONSENT_KEY, value: { agreedAt: new Date().toISOString() } })
          }
        >
          （开发占位）同意并继续
        </button>
      </main>
    );
  }

  return <>{children}</>;
}
