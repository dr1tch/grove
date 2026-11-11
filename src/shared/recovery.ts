import type { Document, TabState, Kind } from "./types";
export type WorkingTab = TabState & {
  id: string;
  asText?: boolean;
  kind?: Kind;
  readError?: string;
  doc: Document;
  value: string;
  disk?: Document;
  error?: string;
  saving?: boolean;
  unavailable?: string;
};
export function recoverTab(
  current: WorkingTab,
  expected: WorkingTab,
  disk: Document,
  currentRoot: string,
  originRoot: string,
): { tab: WorkingTab; clearDraft: boolean } {
  if (currentRoot !== originRoot || current.id !== expected.id)
    return { tab: current, clearDraft: false };
  if (current.value !== expected.value) return { tab: { ...current, disk }, clearDraft: false };
  return {
    tab: { ...current, doc: disk, value: disk.content, disk: undefined, error: undefined },
    clearDraft: true,
  };
}
