import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { CloudStore } from "@grove/github-vault/cloud";
import { VaultStore } from "@grove/github-vault/store";
import { VaultSession } from "@grove/github-vault/sync";
import { GitHubError, rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";
import { BrowserCache } from "./cache";

export type GitHubCredentials = { kind: "github"; ref: RepoRef; token: string; remember: boolean };
export type CloudCredentials = { kind: "cloud"; userId: string; email: string };
export type Credentials = GitHubCredentials | CloudCredentials;
const key = "grove:web:credentials";
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

// Accounts are optional: a build without Supabase settings offers only the token form.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined,
  anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const accounts: SupabaseClient | undefined =
  url && anon
    ? createClient(url, anon, {
        auth: { flowType: "pkce", storageKey: "grove:web:account", detectSessionInUrl: true },
      })
    : undefined;
// Read before Supabase rewrites the URL: a password-reset link returns with ?reset=1.
export const resettingPassword = new URLSearchParams(location.search).has("reset");
const home = () => new URL(import.meta.env.BASE_URL, location.origin).href;

export function storedCredentials(): Credentials | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return;
    if (value.kind === "cloud")
      return typeof value.userId === "string" && uuid.test(value.userId)
        ? { kind: "cloud", userId: value.userId, email: String(value.email ?? "") }
        : undefined;
    if (typeof value.token !== "string" || !value.token || typeof value.remember !== "boolean")
      return;
    rootOf(value.ref);
    return {
      kind: "github",
      ref: { owner: value.ref.owner, repo: value.ref.repo, branch: value.ref.branch },
      token: value.token,
      remember: value.remember,
    };
  } catch {
    return;
  }
}
export function forgetCredentials(): void {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}
export function rememberCredentials(value: Credentials): void {
  forgetCredentials();
  const persistent = value.kind === "cloud" || value.remember;
  (persistent ? localStorage : sessionStorage).setItem(key, JSON.stringify(value));
}
export function cloudCredentials(session: Session): CloudCredentials {
  return { kind: "cloud", userId: session.user.id, email: session.user.email ?? "" };
}
// The GitHub token from a GitHub sign-in, present only right after the OAuth redirect.
export function githubToken(session: Session | null): string | undefined {
  return session?.user.app_metadata.provider === "github"
    ? (session.provider_token ?? undefined)
    : undefined;
}

export async function signInWith(provider: "github" | "google"): Promise<void> {
  const { error } = await accounts!.auth.signInWithOAuth({
    provider,
    // `repo` lets Grove read and write the private repository the user picks next.
    options: { redirectTo: home(), ...(provider === "github" ? { scopes: "repo" } : {}) },
  });
  if (error) throw error;
}
export async function signInWithEmail(email: string, password: string, create: boolean) {
  const { data, error } = create
    ? await accounts!.auth.signUp({ email, password, options: { emailRedirectTo: home() } })
    : await accounts!.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await accounts!.auth.resetPasswordForEmail(email, {
    redirectTo: `${home()}?reset=1`,
  });
  if (error) throw error;
}
export async function setPassword(password: string): Promise<void> {
  const { error } = await accounts!.auth.updateUser({ password });
  if (error) throw error;
  history.replaceState(null, "", home());
}
export async function signOutAccount(): Promise<void> {
  // Local scope: other devices stay signed in.
  await accounts?.auth.signOut({ scope: "local" }).catch(() => {});
}

export type GitHubRepository = { owner: string; repo: string; branch: string; private: boolean };
export async function githubRepositories(token: string): Promise<GitHubRepository[]> {
  const response = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member",
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!response.ok) throw new Error("GitHub did not list your repositories. Sign in again.");
  const values: unknown = await response.json();
  if (!Array.isArray(values)) throw new Error("GitHub returned an invalid repository list.");
  return values.flatMap((value) => {
    const owner = value?.owner?.login,
      repo = value?.name,
      branch = value?.default_branch;
    try {
      rootOf({ owner, repo, branch });
      return value.permissions?.push === false
        ? []
        : [{ owner, repo, branch, private: value.private === true }];
    } catch {
      return [];
    }
  });
}

export async function openVault(credentials: Credentials, resume = false) {
  const store =
    credentials.kind === "cloud"
      ? new CloudStore(accounts!, credentials.userId, "browser")
      : new VaultStore(credentials.ref, credentials.token, { device: "browser" });
  const cache = new BrowserCache(credentials.kind === "cloud" ? store.root : credentials.ref);
  try {
    try {
      await store.head();
    } catch (error) {
      if (
        !(
          resume &&
          error instanceof GitHubError &&
          error.kind === "offline" &&
          (await cache.getTree())
        )
      )
        throw error;
    }
    return { store, cache, session: new VaultSession(store, cache) };
  } catch (error) {
    store.dispose();
    await cache.close().catch(() => {});
    throw error;
  }
}
