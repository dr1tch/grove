import type { SupabaseClient } from "@supabase/supabase-js";
import { rootOf } from "@grove/github-vault/types";
import type { RepoRef } from "@grove/github-vault/types";
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const pendingKey = "grove:web:github-app:pending";
const connectionKey = (user: string) => `grove:web:github-app:${user}`;
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
export async function authorizationURL(
  userId: string,
  callback: string,
  clientId: string,
  storage: StorageLike,
): Promise<string> {
  const state = random(),
    verifier = random(),
    expires = Date.now() + 10 * 60_000;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  storage.setItem(pendingKey, JSON.stringify({ userId, state, verifier, expires }));
  const url = new URL("https://github.com/login/oauth/authorize");
  for (const [key, value] of Object.entries({
    client_id: clientId,
    redirect_uri: callback,
    state,
    scope: "offline_access",
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }))
    url.searchParams.set(key, value);
  return url.href;
}
export function consumeAuthorization(
  url: URL,
  userId: string,
  storage: StorageLike,
): { code: string; verifier: string } {
  const raw = storage.getItem(pendingKey);
  storage.removeItem(pendingKey);
  let saved;
  try {
    saved = JSON.parse(raw ?? "null");
  } catch {
    throw new Error("GitHub connection expired. Start again from Account.");
  }
  if (
    !saved ||
    saved.userId !== userId ||
    typeof saved.state !== "string" ||
    saved.state !== url.searchParams.get("state") ||
    typeof saved.expires !== "number" ||
    saved.expires < Date.now() ||
    saved.expires > Date.now() + 10 * 60_000 ||
    typeof saved.verifier !== "string" ||
    !/^\w{64}$/.test(saved.verifier)
  )
    throw new Error("GitHub connection could not be verified. Start again from Account.");
  if (url.searchParams.has("error"))
    throw new Error("GitHub repository access was not approved. Your Grove account is unchanged.");
  const code = url.searchParams.get("code");
  if (!code || code.length > 512) throw new Error("GitHub did not return a valid connection code.");
  return { code, verifier: saved.verifier };
}
export type GitHubConnection = {
  id: string;
  login: string;
  token: string;
  refresh: string;
  expires: number;
  refreshExpires: number;
};
function connection(value: unknown): GitHubConnection {
  if (!value || typeof value !== "object") throw new Error("Invalid GitHub connection");
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    !/^\d+$/.test(row.id) ||
    typeof row.login !== "string" ||
    !/^[a-z\d_-]+$/i.test(row.login) ||
    typeof row.token !== "string" ||
    !row.token ||
    typeof row.refresh !== "string" ||
    !row.refresh ||
    typeof row.expires !== "number" ||
    !Number.isFinite(row.expires) ||
    typeof row.refreshExpires !== "number" ||
    !Number.isFinite(row.refreshExpires)
  )
    throw new Error("GitHub connection expired. Connect again from Account.");
  return row as GitHubConnection;
}
export class GitHubAccess {
  #refreshing = new Map<string, Promise<GitHubConnection>>();
  #generation = new Map<string, number>();
  constructor(
    private client: SupabaseClient,
    readonly clientId: string,
    readonly slug: string,
    readonly callback: string,
    private storage: StorageLike = sessionStorage,
  ) {}
  async #user(expected?: string): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error || !data.user || (expected && data.user.id !== expected))
      throw new Error("Sign in to the same Grove account before connecting GitHub.");
    return data.user.id;
  }
  connections(userId: string): GitHubConnection[] {
    try {
      const rows: unknown = JSON.parse(this.storage.getItem(connectionKey(userId)) ?? "[]");
      // Skip a damaged entry rather than dropping every connection on the next save.
      return Array.isArray(rows)
        ? rows.flatMap((row) => {
            try {
              return [connection(row)];
            } catch {
              return [];
            }
          })
        : [];
    } catch {
      return [];
    }
  }
  #save(userId: string, value: GitHubConnection) {
    const rows = this.connections(userId).filter((row) => row.id !== value.id);
    this.storage.setItem(connectionKey(userId), JSON.stringify([...rows, value]));
  }
  async #exchange(
    body: Record<string, unknown>,
    userId: string,
    known?: Pick<GitHubConnection, "id" | "login">,
  ): Promise<GitHubConnection> {
    const generation = this.#generation.get(userId);
    await this.#user(userId);
    const { data, error } = await this.client.functions.invoke("github-app", { body });
    if (error)
      throw new Error(
        "GitHub connection could not complete. Reconnect from Account or try again later.",
      );
    const issued = data as Record<string, unknown> | null;
    const now = Date.now();
    const value = connection({
      ...known,
      ...issued,
      expires: now + Number(issued?.expiresIn) * 1000,
      refreshExpires: now + Number(issued?.refreshExpiresIn) * 1000,
    });
    // Local check only: GitHub already rotated the refresh token, so a network failure
    // here must not discard the new one.
    const { data: current } = await this.client.auth.getSession();
    if (current.session?.user.id !== userId || generation !== this.#generation.get(userId))
      throw new Error("GitHub connection was cleared. Connect again from Account.");
    return value;
  }
  async start(): Promise<void> {
    const user = await this.#user();
    location.assign(await authorizationURL(user, this.callback, this.clientId, this.storage));
  }
  async finish(url: URL): Promise<{ userId: string; connection: GitHubConnection }> {
    const userId = await this.#user();
    const { code, verifier } = consumeAuthorization(url, userId, this.storage);
    const value = await this.#exchange(
      { action: "exchange", code, verifier, redirect: this.callback },
      userId,
    );
    this.#save(userId, value);
    return { userId, connection: value };
  }
  async token(userId: string, id: string): Promise<string> {
    const value = this.connections(userId).find((row) => row.id === id);
    if (!value) throw new Error("Connect GitHub on this browser to open that vault.");
    if (value.expires > Date.now() + 60_000) return value.token;
    if (value.refreshExpires <= Date.now())
      throw new Error("GitHub access expired. Connect again from Account.");
    const lock = `${userId}:${id}`;
    let pending = this.#refreshing.get(lock);
    if (!pending) {
      pending = (async () => {
        const next = await this.#exchange(
          { action: "refresh", refreshToken: value.refresh },
          userId,
          { id: value.id, login: value.login },
        );
        this.#save(userId, next);
        return next;
      })().finally(() => this.#refreshing.delete(lock));
      this.#refreshing.set(lock, pending);
    }
    return (await pending).token;
  }
  async request(userId: string, id: string, path: string): Promise<unknown> {
    await this.#user(userId);
    if (!/^\/(user(?:\/installations(?:\/\d+\/repositories)?)?)(?:\?|$)/.test(path))
      throw new Error("Invalid GitHub repository request");
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Authorization: `Bearer ${await this.token(userId, id)}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "GitHub access expired. Connect again from Account."
          : "GitHub could not list repositories. Check installation access and try again.",
      );
    return response.json();
  }
  async repositories(userId: string, id: string): Promise<(RepoRef & { private: boolean })[]> {
    const repositories = new Map<string, RepoRef & { private: boolean }>();
    for (let page = 1; page <= 100; page++) {
      const response = (await this.request(
        userId,
        id,
        `/user/installations?per_page=100&page=${page}`,
      )) as { installations?: { id: number; app_slug?: string }[] };
      if (!Array.isArray(response.installations))
        throw new Error("GitHub returned an invalid installation list");
      for (const installation of response.installations) {
        if (
          !Number.isSafeInteger(installation.id) ||
          installation.id <= 0 ||
          installation.app_slug !== this.slug
        )
          continue;
        for (let repositoryPage = 1; repositoryPage <= 100; repositoryPage++) {
          const data = (await this.request(
            userId,
            id,
            `/user/installations/${installation.id}/repositories?per_page=100&page=${repositoryPage}`,
          )) as { repositories?: Record<string, any>[] };
          if (!Array.isArray(data.repositories))
            throw new Error("GitHub returned an invalid repository list");
          for (const row of data.repositories) {
            try {
              const ref = { owner: row.owner?.login, repo: row.name, branch: row.default_branch };
              rootOf(ref);
              if (row.permissions?.push === false) continue;
              repositories.set(rootOf(ref), { ...ref, private: row.private === true });
            } catch {
              /* Ignore unsupported repository metadata. */
            }
          }
          if (data.repositories.length < 100) break;
          if (repositoryPage === 100)
            throw new Error(
              "Too many repositories to list completely. Narrow the GitHub App installation.",
            );
        }
      }
      if (response.installations.length < 100) return [...repositories.values()];
    }
    throw new Error("Too many installations to list completely.");
  }
  clear(userId: string): void {
    this.#generation.set(userId, (this.#generation.get(userId) ?? 0) + 1);
    this.storage.removeItem(connectionKey(userId));
    this.storage.removeItem(pendingKey);
  }
}
