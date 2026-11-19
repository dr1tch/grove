import { expect, it, vi } from "vite-plus/test";
import { createClient } from "@supabase/supabase-js";
import { authorizationURL, consumeAuthorization, GitHubAccess } from "./github-app";
function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}
it("starts independent GitHub App access with state and S256 PKCE without repo scope", async () => {
  const saved = storage(),
    url = new URL(
      await authorizationURL("user-a", "https://grove.test/github-callback.html", "client", saved),
    );
  expect(url.origin).toBe("https://github.com");
  expect(url.searchParams.get("scope")).toBe("offline_access");
  expect(url.searchParams.get("code_challenge")).toHaveLength(43);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const callback = new URL("https://grove.test/github-callback.html");
  callback.searchParams.set("code", "one-use-code");
  callback.searchParams.set("state", url.searchParams.get("state")!);
  expect(consumeAuthorization(callback, "user-a", saved).verifier).toHaveLength(64);
  expect(() => consumeAuthorization(callback, "user-a", saved)).toThrow();
});
// The current Grove session, read locally after a token exchange.
function signedIn(auth: ReturnType<typeof createClient>["auth"], id: string) {
  vi.spyOn(auth, "getSession").mockResolvedValue({
    data: { session: { user: { id } } },
    error: null,
  } as never);
}
it.each([false, true])(
  "serializes refreshes and respects connection clearing: %s",
  async (clear) => {
    const saved = storage();
    const client = createClient("https://project.test", "public-key", {
      auth: { persistSession: false },
    });
    vi.spyOn(client.auth, "getUser").mockResolvedValue({
      data: {
        user: {
          id: "a",
          app_metadata: {},
          user_metadata: {},
          aud: "authenticated",
          created_at: "",
        },
      },
      error: null,
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    signedIn(client.auth, "a");
    const stored = {
      id: "1",
      login: "fixture",
      token: "old",
      refresh: "ghr_old",
      expires: 0,
      refreshExpires: Date.now() + 86_400_000,
    };
    const next = { token: "new", refresh: "next", expiresIn: 3600, refreshExpiresIn: 86_400 };
    const functions = client.functions;
    vi.spyOn(client, "functions", "get").mockReturnValue(functions);
    const invoke = vi.spyOn(functions, "invoke").mockImplementation(async () => {
      await gate;
      return { data: next, error: null };
    });
    const access = new GitHubAccess(client, "client", "slug", "https://grove.test/callback", saved);
    saved.setItem("grove:web:github-app:a", JSON.stringify([stored]));
    await expect(access.token("b", "1")).rejects.toThrow("Connect GitHub");
    const first = access.token("a", "1"),
      second = access.token("a", "1");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    if (clear) access.clear("a");
    release();
    if (clear) {
      await expect(first).rejects.toThrow();
      await expect(second).rejects.toThrow();
      expect(access.connections("a")).toEqual([]);
    } else {
      expect(await Promise.all([first, second])).toEqual(["new", "new"]);
      expect(await access.token("a", "1")).toBe("new");
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  },
);
it("keeps rotated tokens when Supabase fails right after a refresh", async () => {
  const saved = storage();
  const client = createClient("https://project.test", "public-key", {
    auth: { persistSession: false },
  });
  signedIn(client.auth, "a");
  // The pre-flight account check passes; every later network call to Supabase fails.
  vi.spyOn(client.auth, "getUser")
    .mockResolvedValueOnce({ data: { user: { id: "a" } }, error: null } as never)
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const functions = client.functions;
  vi.spyOn(client, "functions", "get").mockReturnValue(functions);
  vi.spyOn(functions, "invoke").mockResolvedValue({
    data: { token: "new", refresh: "ghr_new", expiresIn: 3600, refreshExpiresIn: 86_400 },
    error: null,
  } as never);
  saved.setItem(
    "grove:web:github-app:a",
    JSON.stringify([
      {
        id: "1",
        login: "a_b",
        token: "old",
        refresh: "ghr_old",
        expires: 0,
        refreshExpires: Date.now() + 1e6,
      },
    ]),
  );
  const access = new GitHubAccess(client, "client", "slug", "https://grove.test/callback", saved);
  expect(await access.token("a", "1")).toBe("new");
  expect(access.connections("a")).toMatchObject([{ id: "1", login: "a_b", refresh: "ghr_new" }]);
});
it("keeps valid connections when one stored entry is damaged", () => {
  const saved = storage();
  const client = createClient("https://project.test", "public-key", {
    auth: { persistSession: false },
  });
  saved.setItem(
    "grove:web:github-app:a",
    JSON.stringify([
      { id: "x" },
      { id: "2", login: "ok", token: "t", refresh: "r", expires: 1, refreshExpires: 2 },
    ]),
  );
  const access = new GitHubAccess(client, "client", "slug", "https://grove.test/callback", saved);
  expect(access.connections("a").map((row) => row.id)).toEqual(["2"]);
});
it("rejects a switched Grove account, forged state, expired state and denied access", async () => {
  for (const kind of ["user", "state", "expired", "denied"]) {
    const saved = storage(),
      url = new URL(
        await authorizationURL("a", "https://grove.test/github-callback.html", "client", saved),
      );
    const callback = new URL("https://grove.test/github-callback.html?code=one");
    callback.searchParams.set(
      "state",
      kind === "state" ? "forged" : url.searchParams.get("state")!,
    );
    if (kind === "expired") {
      const key = "grove:web:github-app:pending",
        value = JSON.parse(saved.getItem(key)!);
      value.expires = 0;
      saved.setItem(key, JSON.stringify(value));
    }
    if (kind === "denied") callback.searchParams.set("error", "access_denied");
    expect(() => consumeAuthorization(callback, kind === "user" ? "b" : "a", saved)).toThrow();
  }
});
