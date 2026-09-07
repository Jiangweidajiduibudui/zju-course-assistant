import { createContext, useContext } from "react";
import type { HttpWorkspace } from "./http.js";
import type { WorkspacePort } from "./port.js";
export type DemoControls = {
  initialSnapshotId: string;
  nextSnapshotId: string;
  publish: () => Promise<void>;
  failNextLoad: () => void;
  reset: () => void;
};
export type WorkspaceInfo = Awaited<ReturnType<HttpWorkspace["initialize"]>>;
export const WorkspaceContext = createContext<{
  api: WorkspacePort;
  demo: DemoControls | null;
  info: WorkspaceInfo;
  refreshInfo: (termId?: string) => Promise<void>;
} | null>(null);
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace adapter is required");
  return value;
}
