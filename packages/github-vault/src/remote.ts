import type { Document, SaveResult, Version } from "@grove/core/types";
import type { VaultEntry } from "./types";

// What VaultSession needs from a remote vault: GitHub (VaultStore) or Grove cloud (CloudStore).
// Errors are GitHubError with a shared kind, so sync handles both backends the same way.
export interface RemoteStore {
  readonly root: string;
  readonly device: string;
  dispose(): void;
  head(): Promise<string>;
  list(): Promise<VaultEntry[]>;
  read(path: string): Promise<Document>;
  readAsset(path: string): Promise<{ hash: string; bytes: Uint8Array }>;
  write(path: string, content: string, baseHash: string): Promise<SaveResult>;
  create(path: string, content: string): Promise<Document>;
  createBytes(path: string, bytes: Uint8Array): Promise<void>;
  remove(path: string): Promise<void>;
  rename(path: string, target: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  versions(path: string): Promise<Version[]>;
}
