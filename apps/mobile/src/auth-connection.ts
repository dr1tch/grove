import { rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";

export type MobileConnection =
  | { kind: "github"; ref: RepoRef; token: string }
  | { kind: "cloud"; userId: string; email: string };

export function validateConnection(input: unknown): MobileConnection {
  if (!input || typeof input !== "object") throw new Error("Invalid saved vault connection.");
  const value = input as Record<string, unknown>;
  if (
    value.kind === "cloud" &&
    typeof value.userId === "string" &&
    /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value.userId) &&
    typeof value.email === "string" &&
    value.email.length <= 320
  )
    return { kind: "cloud", userId: value.userId, email: value.email };
  if (
    value.kind === "github" &&
    typeof value.token === "string" &&
    value.token.length > 0 &&
    value.token.length <= 4096 &&
    !/\s/.test(value.token) &&
    value.ref &&
    typeof value.ref === "object"
  ) {
    const ref = value.ref as RepoRef;
    rootOf(ref);
    return {
      kind: "github",
      ref: { owner: ref.owner, repo: ref.repo, branch: ref.branch },
      token: value.token,
    };
  }
  throw new Error("Invalid saved vault connection. Reconnect your vault.");
}
