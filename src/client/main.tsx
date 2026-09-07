import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Button } from "./components/ui.js";
import type { DemoControls, WorkspaceInfo } from "./data/context.js";
import { WorkspaceContext } from "./data/context.js";
import { HttpWorkspace } from "./data/http.js";
import type { WorkspacePort } from "./data/port.js";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});
let adapter: WorkspacePort;
let demo: DemoControls | null = null;
let initial: WorkspaceInfo | null = null;
if (import.meta.env.MODE === "fixture") {
  const { FixtureWorkspace } = await import("../../fixtures/ui/workspace.js");
  const { originalSnapshot } = await import("../../fixtures/ui/catalog.js");
  const fixture = new FixtureWorkspace({
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key),
  });
  adapter = fixture;
  demo = fixture;
  initial = {
    terms: [originalSnapshot.term],
    termId: originalSnapshot.term.id,
    termLabel: originalSnapshot.term.label,
    initialSnapshotId: fixture.initialSnapshotId,
    nextSnapshotId: fixture.nextSnapshotId,
    synthetic: true,
    storageLabel: "本机浏览器",
    dataDirectory: "浏览器 localStorage（仅演示）",
  };
} else adapter = new HttpWorkspace();
function Root() {
  const [info, setInfo] = useState(initial);
  const [error, setError] = useState("");
  const refreshInfo = useCallback(async (termId?: string) => {
    if (adapter instanceof HttpWorkspace) {
      const next = await adapter.initialize(termId);
      setInfo(next);
      await client.resetQueries({ queryKey: ["workspace"] });
    }
  }, []);
  useEffect(() => {
    if (!initial) void refreshInfo().catch((e) => setError(e.message));
  }, [refreshInfo]);
  if (!info)
    return (
      <main className="empty">
        <h1>本机选课工作台</h1>
        <p role="status">{error || "正在连接本机服务…"}</p>
        {error && (
          <Button
            onClick={() => {
              setError("");
              void refreshInfo().catch((e) => setError(e.message));
            }}
          >
            重新连接
          </Button>
        )}
      </main>
    );
  return (
    <WorkspaceContext.Provider
      value={{ api: adapter, demo, info, refreshInfo }}
    >
      <App />
    </WorkspaceContext.Provider>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
