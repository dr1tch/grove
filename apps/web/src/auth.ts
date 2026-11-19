import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { CloudStore } from "@grove/github-vault/cloud";
import { VaultStore } from "@grove/github-vault/store";
import { VaultSession } from "@grove/github-vault/sync";
import { GitHubError, rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";
import { GitHubAccess } from "./github-app";
import { BrowserCache } from "./cache";

export type GitHubCredentials = {
  kind: "github";
  ref: RepoRef;
  token: string;
  remember: boolean;
  connectionId?: string;
  accountId?: string;
};
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
        auth: {
          flowType: "pkce",
          storageKey: "grove:web:account",
          detectSessionInUrl: !location.pathname.endsWith("/github-callback.html"),
        },
      })
    : undefined;
const returned = new URLSearchParams(location.search);
export const resettingPassword = returned.has("reset");
export const githubCallback = location.pathname.endsWith("/github-callback.html");
export const callbackURL = new URL(
  "github-callback.html",
  new URL(import.meta.env.BASE_URL, location.origin),
).href;
const failure = new URLSearchParams(location.hash.slice(1)).get("error_code")
  ? new URLSearchParams(location.hash.slice(1))
  : returned;
export const returnedError = failure.get("error_code")
  ? "Provider sign-in failed. Your saved vaults are unchanged. Try signing in again."
  : "";
const home = () => new URL(import.meta.env.BASE_URL, location.origin).href;
export const githubAccess =
  accounts && import.meta.env.VITE_GITHUB_APP_CLIENT_ID && import.meta.env.VITE_GITHUB_APP_SLUG
    ? new GitHubAccess(
        accounts,
        import.meta.env.VITE_GITHUB_APP_CLIENT_ID,
        import.meta.env.VITE_GITHUB_APP_SLUG,
        callbackURL,
      )
    : undefined;

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
      ...(typeof value.connectionId === "string" && typeof value.accountId === "string"
        ? { connectionId: value.connectionId, accountId: value.accountId }
        : {}),
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
  const persistent = value.kind === "cloud" || (!value.connectionId && value.remember);
  const stored =
    value.kind === "github" && value.connectionId
      ? { ...value, token: "app", remember: false }
      : value;
  (persistent ? localStorage : sessionStorage).setItem(key, JSON.stringify(stored));
}
export function cloudCredentials(session: Session): CloudCredentials {
  return { kind: "cloud", userId: session.user.id, email: session.user.email ?? "" };
}
export async function connectGitHub(): Promise<void> {
  if (!githubAccess)
    throw new Error(
      "GitHub App connections are not available yet. You can use a GitHub token in this browser instead.",
    );
  await githubAccess.start();
}
export async function accountSession(): Promise<Session | null> {
  return accounts ? (await accounts.auth.getSession()).data.session : null;
}

export async function signInWith(provider: "github" | "google"): Promise<void> {
  const { error } = await accounts!.auth.signInWithOAuth({
    provider,
    // Grove sign-in is separate from repository permissions.
    options: { redirectTo: home() },
  });
  if (error) throw error;
}
// Cloudflare Turnstile site key; when set, Supabase must have captcha enabled with its secret.
export const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
export async function signInWithEmail(
  email: string,
  password: string,
  create: boolean,
  captchaToken?: string,
) {
  const { data, error } = create
    ? await accounts!.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: home(), captchaToken },
      })
    : await accounts!.auth.signInWithPassword({ email, password, options: { captchaToken } });
  if (error) throw error;
  return data.session;
}
export async function sendPasswordReset(email: string, captchaToken?: string): Promise<void> {
  const { error } = await accounts!.auth.resetPasswordForEmail(email, {
    redirectTo: `${home()}?reset=1`,
    captchaToken,
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
  let transport: typeof fetch | undefined;
  if (credentials.kind === "github" && credentials.connectionId) {
    if (!githubAccess || !credentials.accountId)
      throw new Error("Connect GitHub again on this browser.");
    const user = (await accounts!.auth.getSession()).data.session?.user.id;
    if (user !== credentials.accountId)
      throw new Error("This GitHub connection belongs to another Grove account.");
    const connectionId = credentials.connectionId,
      accountId = credentials.accountId;
    const getToken = async () => {
      if ((await accounts!.auth.getSession()).data.session?.user.id !== accountId)
        throw new Error("Sign in to the same Grove account.");
      return githubAccess!.token(accountId, connectionId);
    };
    credentials = { ...credentials, token: await getToken() };
    transport = async (input, init) => {
      const target = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
      if (target.origin !== "https://api.github.com") throw new Error("Invalid GitHub API origin");
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await getToken()}`);
      return fetch(input, {
        ...init,
        headers,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
    };
  }
  const store =
    credentials.kind === "cloud"
      ? new CloudStore(accounts!, credentials.userId, "browser")
      : new VaultStore(credentials.ref, credentials.token, { device: "browser", fetch: transport });
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
