import { useState } from "react";
import { ImportExportPage } from "../features/import-export/ImportExportPage";
import { ConsentGate } from "../features/settings/ConsentGate";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TimetablePage } from "../features/timetable-projection/TimetablePage";
import { WishPlanPage } from "../features/wish-plan/WishPlanPage";

/**
 * 应用外壳（组员 E）。
 *
 * 导航原则（docs/08 §3.2）：未完成页面隐藏在正式导航外 ——
 * 当前全部页面均为脚手架占位，顶部横幅明示，不伪装成真实功能。
 * 暂不引入路由库（新增依赖须按 docs/07 §6 决策）。
 */
const tabs = [
  { id: "import", label: "导入/导出", node: <ImportExportPage /> },
  { id: "wish", label: "待筛选志愿", node: <WishPlanPage /> },
  { id: "timetable", label: "预期课表", node: <TimetablePage /> },
  { id: "settings", label: "设置", node: <SettingsPage /> },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function App() {
  const [active, setActive] = useState<TabId>("import");
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
        {tabs.find((tab) => tab.id === active)?.node}
      </div>
    </ConsentGate>
  );
}
