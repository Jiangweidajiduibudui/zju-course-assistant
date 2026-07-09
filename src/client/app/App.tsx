import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import type { Catalog, Session } from "../../shared/contracts/index.js";
import { ImportExportPage } from "../features/import-export/ImportExportPage";
import { buildDemoSessionDraft } from "../features/import-export/sessionDraft";
import { ConsentGate } from "../features/settings/ConsentGate";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TimetablePage } from "../features/timetable-projection/TimetablePage";
import { WishPlanPage } from "../features/wish-plan/WishPlanPage";
import { db } from "./db";

/**
 * 应用外壳（组员 E）。
 *
 * 导航原则（docs/08 §3.2）：未完成页面隐藏在正式导航外 ——
 * 当前全部页面均为脚手架占位，顶部横幅明示，不伪装成真实功能。
 * 暂不引入路由库（新增依赖须按 docs/07 §6 决策）。
 */
const tabs = [
  { id: "import", label: "导入/导出" },
  { id: "wish", label: "待筛选志愿" },
  { id: "timetable", label: "预期课表" },
  { id: "settings", label: "设置" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function App() {
  const [active, setActive] = useState<TabId>("import");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const persistedSession = useLiveQuery(
    async () => {
      const sessions = await db.sessions.orderBy("createdAt").reverse().limit(1).toArray();
      return sessions[0] ?? null;
    },
    [],
    null,
  );
  const activeSession = session ?? persistedSession;

  async function handleLoadDemoCatalog(nextCatalog: Catalog): Promise<void> {
    const nextSession = buildDemoSessionDraft(nextCatalog);
    await db.sessions.put(nextSession);
    setCatalog(nextCatalog);
    setSession(nextSession);
  }

  const activePage =
    active === "import" ? (
      <ImportExportPage
        catalog={catalog}
        session={activeSession}
        onLoadDemoCatalog={handleLoadDemoCatalog}
        onOpenTimetable={() => setActive("timetable")}
        onOpenWishPlan={() => setActive("wish")}
      />
    ) : active === "wish" ? (
      <WishPlanPage
        catalog={catalog}
        session={activeSession}
        onOpenTimetable={() => setActive("timetable")}
      />
    ) : active === "timetable" ? (
      <TimetablePage catalog={catalog} session={activeSession} />
    ) : (
      <SettingsPage />
    );

  return (
    <ConsentGate>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900">
          ⚠️ 开发脚手架：所有页面均为占位，尚无真实功能。advise-only —— 本网站永不写入 zdbk。
        </div>
        <nav className="flex gap-2 border-b bg-white px-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`px-3 py-2 text-sm ${
                active === tab.id ? "border-b-2 border-blue-600 font-semibold" : "text-gray-500"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        {activePage}
      </div>
    </ConsentGate>
  );
}
