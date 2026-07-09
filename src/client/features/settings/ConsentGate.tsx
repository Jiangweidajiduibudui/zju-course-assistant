import { useLiveQuery } from "dexie-react-hooks";
import type { ReactNode } from "react";
import { db } from "../../app/db";

/**
 * 首次引导 + 隐私同意闸门（组员 E；FR-11、D23）。
 *
 * 铁律：未同意前无任何功能可用（AC-11.1）。本页只记录本地同意态；不上传、
 * 不写入 zdbk、不保存任何 zdbk Cookie/token/密码。
 */
const CONSENT_KEY = "privacy-consent.v1";

const willDo = [
  "使用本地 IndexedDB 保存当前 session 草稿，清除数据后即消失。",
  "导入的课程、待选池、偏好和对话只用于生成规划建议。",
  "未来生成推荐时，可能把课表、偏好和对话发送给你自配的 LLM 端点。",
];

const willNotDo = [
  "不保存 zdbk Cookie、token、密码，也不代替你提交志愿。",
  "不在服务端持久化 API key，姓名和学号不进入提示词。",
  "不写入 zdbk，不选课、不退课、不调序。",
];

export function ConsentGate({ children }: { children: ReactNode }) {
  // useLiveQuery 默认初始值也是 undefined；而 kv.get 不存在时也会返回 undefined。
  // 用 null 作为加载态哨兵，避免首次用户永远停在“加载中…”。
  const consent = useLiveQuery(() => db.kv.get(CONSENT_KEY), [], null);

  if (consent === null) {
    return (
      <main className="app-shell flex min-h-[100dvh] items-center justify-center p-6">
        <div className="panel px-6 py-5 text-sm text-ink-muted">加载中...</div>
      </main>
    );
  }

  if (!consent) {
    return (
      <main className="app-shell flex min-h-[100dvh] items-center justify-center px-6 py-12">
        <section className="w-full max-w-[560px] fade-up" aria-labelledby="privacy-heading">
          <div className="flex items-center gap-3">
            <span className="brand-mark" aria-hidden="true">
              选
            </span>
            <span className="text-base font-bold tracking-[-0.01em] text-ink">选课助手</span>
            <span className="pill pill-blue px-2.5 py-1">advise-only</span>
          </div>

          <div className="mt-6">
            <p className="text-[13px] font-semibold text-blue-strong">AI 选课助手</p>
            <h1 className="mt-2 text-[38px] font-bold leading-[1.12] tracking-[-0.02em] text-ink">
              首次使用：隐私声明
            </h1>
            <p className="mt-4 text-[17px] leading-7 text-ink-muted">
              只提供建议，永不写入选课系统。导入课程与偏好后，在你圈定的候选范围内生成可解释的规划。
            </p>
          </div>

          <div className="panel mt-7 p-6">
            <h2 className="text-[15px] font-semibold text-ink">进入前请确认</h2>
            <div className="mt-5 grid gap-5">
              <div>
                <h3 className="text-[13px] font-semibold text-blue-ink">会做的</h3>
                <ul className="mt-3 grid gap-3">
                  {willDo.map((item) => (
                    <li key={item} className="flex gap-3 text-[13px] leading-6 text-ink-body">
                      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-blue-sky text-[12px] font-bold text-cream-white">
                        ✓
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="h-px bg-hairline" />

              <div>
                <h3 className="text-[13px] font-semibold text-warn">不会做的</h3>
                <ul className="mt-3 grid gap-3">
                  {willNotDo.map((item) => (
                    <li key={item} className="flex gap-3 text-[13px] leading-6 text-ink-body">
                      <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-warn-bg text-[13px] font-bold text-warn ring-1 ring-warn-border">
                        ×
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <button
              type="button"
              className="primary-button mt-6 w-full px-4 py-3"
              onClick={() =>
                db.kv.put({ key: CONSENT_KEY, value: { agreedAt: new Date().toISOString() } })
              }
            >
              同意并继续
            </button>
            <p className="mt-3 text-[11.5px] leading-5 text-ink-faint">
              不同意则无法进入产品。你可以在设置中清除全部本地数据，清除后会重新要求同意。
            </p>
          </div>
        </section>
      </main>
    );
  }

  return <>{children}</>;
}
