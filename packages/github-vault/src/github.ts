import { MAX_SYNC_BYTES } from "@grove/core/conflicts";
import { GitHubError, object, rootOf } from "./types";
import type { GitHubErrorKind, RepoRef } from "./types";

export class GitHub {
  #token: string;
  #fetch: typeof fetch;
  #base: string;
  constructor(ref: RepoRef, token: string, transport: typeof fetch = fetch) {
    rootOf(ref);
    if (!token || /\s/.test(token)) throw new GitHubError("auth", "Enter a valid GitHub token.");
    this.#token = token;
    this.#fetch = transport;
    this.#base = `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
  }
  async request(
    path: string,
    init: { method?: string; body?: unknown; raw?: boolean } = {},
  ): Promise<Response> {
    const url = new URL(`https://api.github.com${this.#base}${path}`);
    let response: Response;
    try {
      response = await this.#fetch(url.toString(), {
        method: init.method ?? "GET",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: {
          Accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          Authorization: `Bearer ${this.#token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    } catch {
      throw new GitHubError(
        "offline",
        "GitHub is unreachable. Your pending changes are kept locally.",
      );
    }
    if (
      response.redirected ||
      (response.url && new URL(response.url).origin !== url.origin) ||
      (response.status >= 300 && response.status < 400)
    ) {
      throw new GitHubError(
        "no-access",
        "GitHub redirected the request. Credentials were not forwarded.",
        response.status,
      );
    }
    if (!response.ok) {
      const { status, headers } = response;
      const rate =
        status === 429 ||
        (status === 403 &&
          (headers.get("x-ratelimit-remaining") === "0" || headers.has("retry-after")));
      const kind: GitHubErrorKind = rate
        ? "rate-limit"
        : status === 401
          ? "auth"
          : status === 403
            ? "no-access"
            : status === 404
              ? "not-found"
              : status === 409
                ? "conflict"
                : status === 422
                  ? "rejected"
                  : "other";
      const retry = Number(headers.get("retry-after"));
      const reset = Number(headers.get("x-ratelimit-reset"));
      const retryAfter =
        retry > 0 ? retry : reset > 0 ? Math.max(0, reset - Date.now() / 1000) : undefined;
      throw new GitHubError(
        kind,
        `GitHub ${kind === "rate-limit" ? "rate limit reached; try again later" : kind === "rejected" ? "rejected the change; check branch protection and repository rules" : kind === "not-found" ? "file or repository not found" : kind === "auth" ? "token is invalid or expired" : kind === "no-access" ? "access denied; check token permissions and branch protection" : kind === "conflict" ? "file changed elsewhere" : "request failed"}.`,
        status,
        retryAfter,
      );
    }
    return response;
  }
  async json(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const response = await this.request(path, init);
    try {
      return await response.json();
    } catch (error) {
      if (!(error instanceof SyntaxError))
        throw new GitHubError(
          "offline",
          "GitHub response was interrupted. Cached work is kept locally.",
        );
      throw new GitHubError("other", "GitHub returned invalid JSON.");
    }
  }
  async bytes(path: string): Promise<Uint8Array> {
    const response = await this.request(path, { raw: true });
    try {
      const length = response.headers.get("content-length");
      if (length && Number(length) > MAX_SYNC_BYTES)
        throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
      const reader = response.body?.getReader?.();
      if (!reader) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_SYNC_BYTES)
          throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
        return bytes;
      }
      const parts: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_SYNC_BYTES) {
            await reader.cancel().catch(() => {});
            throw new GitHubError("rejected", "File exceeds the 50 MiB sync limit.");
          }
          parts.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      return bytes;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(
        "offline",
        "GitHub response was interrupted. Cached work is kept locally.",
      );
    }
  }
}
export function documentAt(value: unknown) {
  if (Array.isArray(value))
    throw new GitHubError(
      "rejected",
      "Folder moves and deletion are not supported. Choose a regular file.",
    );
  const result = object(value);
  if (result.type !== "file" || result.submodule_git_url)
    throw new GitHubError("rejected", "Only regular files are supported for this operation.");
  return result;
}
