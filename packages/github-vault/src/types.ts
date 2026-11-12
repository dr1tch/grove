import type { Entry } from "@grove/core/types";
export type RepoRef = { owner: string; repo: string; branch: string };
export type VaultEntry = Entry & { sha: string };
export type GitHubErrorKind =
  | "auth"
  | "no-access"
  | "not-found"
  | "conflict"
  | "rejected"
  | "rate-limit"
  | "offline"
  | "other";
export class GitHubError extends Error {
  constructor(
    public kind: GitHubErrorKind,
    message: string,
    public status = 0,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}
export function rootOf(ref: RepoRef): string {
  if (
    typeof ref.owner !== "string" ||
    typeof ref.repo !== "string" ||
    typeof ref.branch !== "string" ||
    !/^[a-z\d-]+$/i.test(ref.owner) ||
    !/^[a-z\d_.-]+$/i.test(ref.repo) ||
    ref.repo === "." ||
    ref.repo === ".." ||
    !ref.branch ||
    // oxlint-disable-next-line no-control-regex -- Reject control characters in Git references.
    /[\x00-\x20\x7f~^:?*[\\]/.test(ref.branch) ||
    ref.branch.includes("..") ||
    ref.branch.startsWith("/") ||
    ref.branch.endsWith("/") ||
    ref.branch.includes("//") ||
    ref.branch.endsWith(".lock")
  ) {
    throw new GitHubError("rejected", "Use a valid GitHub owner, repository and branch.");
  }
  return `github:${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}@${ref.branch}`;
}
export function vaultPath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    // oxlint-disable-next-line no-control-regex -- Reject controls at the remote path boundary.
    /[\\\x00-\x1f\x7f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new GitHubError(
      "rejected",
      "Use a relative vault path without empty or parent segments.",
    );
  }
  return path;
}
export function visiblePath(path: string): boolean {
  return !path
    .split("/")
    .some(
      (part) =>
        [".git", ".folio", ".trash", "node_modules", ".DS_Store", "Thumbs.db", ".gitkeep"].includes(
          part,
        ) || part.includes(".before-export"),
    );
}
export function filePath(path: string): string {
  vaultPath(path);
  if (!visiblePath(path))
    throw new GitHubError(
      "rejected",
      "Grove metadata and recovery paths cannot be edited through sync.",
    );
  return path;
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new GitHubError("other", "GitHub returned invalid data.");
  return value as Record<string, unknown>;
}
export function string(value: unknown): string {
  if (typeof value !== "string") throw new GitHubError("other", "GitHub returned invalid text.");
  return value;
}
export function sha(value: unknown): string {
  const result = string(value);
  if (!/^[a-f\d]{40}$/i.test(result))
    throw new GitHubError("other", "GitHub returned an invalid file hash.");
  return result;
}
export function size(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new GitHubError("other", "GitHub returned an invalid size.");
  return value;
}
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}
export function base64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 16384)
    result += String.fromCharCode(...bytes.subarray(index, index + 16384));
  return btoa(result);
}
