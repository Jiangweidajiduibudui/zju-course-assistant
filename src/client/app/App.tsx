import { useLiveQuery } from "dexie-react-hooks";
import { Redo, Undo } from "lucide-react";
import { useCallback, useState } from "react";
import type { Catalog, Session } from "../../shared/contracts/index.js";
import { sessionSchema } from "../../shared/contracts/index.js";
import { ImportExportPage } from "../features/import-export/ImportExportPage";
import { buildDemoSessionDraft } from "../features/import-export/sessionDraft";
import { updateSessionCreditLimit } from "../features/session/sessionRules";
import { ConsentGate } from "../features/settings/ConsentGate";
import { SettingsPage } from "../features/settings/SettingsPage";
import { TimetablePage } from "../features/timetable-projection/TimetablePage";
import { WishPlanPage } from "../features/wish-plan/WishPlanPage";
import { clearAllLocalData, db } from "./db";

/**
 * 应用外壳（组员 E）。
 *
 * 导航原则（docs/08 §3.2）：使用标签页切换，不引入路由库。
 * 回滚：通过 session.history 栈实现 undo/redo（AC-7.3）。
 */
const tabs = [
  { id: "import", label: "导入/导出" },
  { id: "wish", label: "待筛选志愿" },
  { id: "timetable", label: "预期课表" },
  { id: "settings", label: "设置" },
] as const;

type TabId = (typeof tabs)[number]["id"];

/** 撤销：弹出最后一个历史快照，交换当前状态 */
function undoSession(session: Session): Session {
  if (session.history.length === 0) return session;
  const history = [...session.history];
  const snapshot = history.pop();
  if (!snapshot) return session;
  return sessionSchema.parse({
    ...session,
    pool: snapshot.pool,
    rules: snapshot.rules,
    plan: snapshot.plan,
    history,
  });
}

/** 重做：当前状态入历史，从 redo 栈（由调用方维护）恢复 */
function pushHistory(session: Session, label: string): Session {
  const entry = {
    at: new Date().toISOString(),
    label,
    pool: session.pool,
    rules: session.rules,
    plan: session.plan,
  };
  const history = [...session.history, entry].slice(-20);
  return sessionSchema.parse({ ...session, history });
}

export function App() {
  const [active, setActive] = useState<TabId>("import");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [redoStack, setRedoStack] = useState<Session[]>([]);

  const persistedSession = useLiveQuery(
    async () => {
      const sessions = await db.sessions.orderBy("createdAt").reverse().limit(1).toArray();
      return sessions[0] ?? null;
    },
    [],
    null,
  );
  const activeSession = session ?? persistedSession;

  const saveSession = useCallback(async (next: Session) => {
    await db.sessions.put(next);
    setSession(next);
  }, []);

  async function handleLoadDemoCatalog(nextCatalog: Catalog): Promise<void> {
    const nextSession = buildDemoSessionDraft(nextCatalog);
    await db.sessions.put(nextSession);
    setCatalog(nextCatalog);
    setSession(nextSession);
    setRedoStack([]);
  }

  async function handleUpdateCreditLimit(creditLimit: number): Promise<void> {
    if (!activeSession) return;
    const snapshotted = pushHistory(activeSession, "修改学分上限");
    const nextSession = updateSessionCreditLimit(snapshotted, creditLimit);
    await saveSession(nextSession);
    setRedoStack([]);
  }

  async function handleClearAllLocalData(): Promise<void> {
    await clearAllLocalData();
    setCatalog(null);
    setSession(null);
    setRedoStack([]);
  }

  async function handleUndo(): Promise<void> {
    if (!activeSession || activeSession.history.length === 0) return;
    const redoEntry = { ...activeSession, history: [] };
    setRedoStack((prev) => [redoEntry, ...prev].slice(0, 20));
    const undone = undoSession(activeSession);
    await saveSession(undone);
  }

  async function handleRedo(): Promise<void> {
    if (redoStack.length === 0 || !activeSession) return;
    const [nextSession, ...rest] = redoStack;
    if (!nextSession) return;
    // 当前状态入历史
    const snapshotted = pushHistory(activeSession, "redo 前状态");
    await saveSession(snapshotted);
    setRedoStack(rest);
    await saveSession(nextSession);
  }

  const canUndo = (activeSession?.history.length ?? 0) > 0;
  const canRedo = redoStack.length > 0;

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
      <SettingsPage
        session={activeSession}
        onUpdateCreditLimit={handleUpdateCreditLimit}
        onClearAllLocalData={handleClearAllLocalData}
      />
    );

  return (
    <ConsentGate>
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <nav className="flex items-center gap-2 border-b bg-white px-4">
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
          <div className="ml-auto flex items-center gap-1 pr-2">
            <button
              type="button"
              disabled={!canUndo}
              onClick={handleUndo}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
              title={`撤销（历史 ${activeSession?.history.length ?? 0}/20）`}
            >
              <Undo size={14} />
            </button>
            <button
              type="button"
              disabled={!canRedo}
              onClick={handleRedo}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-30"
              title="重做"
            >
              <Redo size={14} />
            </button>
          </div>
        </nav>
        {activePage}
      </div>
    </ConsentGate>
  );
}
