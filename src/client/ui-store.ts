import { create } from "zustand";

type UiState = {
  modelSettingsOpen: boolean;
  planId: string;
  tab: "explore" | "shortlist" | "draft";
  query: string;
  availableOnly: boolean;
  partId: string;
  alternatives: boolean;
  set: (patch: Partial<Omit<UiState, "set">>) => void;
};

// UI state only. Plans, snapshots and derived reports are fetched through Query.
export const useUi = create<UiState>((set) => ({
  modelSettingsOpen: false,
  planId: "plan-main",
  tab: "explore",
  query: "",
  availableOnly: false,
  partId: "autumn",
  alternatives: false,
  set,
}));
