import { expect, it } from "vite-plus/test";
import { githubAppHandler } from "../../../supabase/functions/github-app/handler";
const config = {
  clientId: "public-client",
  clientSecret: "server-secret",
  webURLs: ["https://grove.test/grove/app/"],
};
function request(body: unknown, origin = "https://grove.test", auth = "Bearer grove-user") {
  return new Request("https://project.test/functions/v1/github-app", {
    method: "POST",
    headers: { origin, authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
it("rejects untrusted origins, unsigned users, bad redirects and missing PKCE before contacting GitHub", async () => {
  let calls = 0;
  const handler = githubAppHandler(config, {
    user: async (value) => (value === "Bearer grove-user" ? "user" : undefined),
    fetch: async () => {
      calls++;
      return new Response();
    },
  });
  for (const [body, origin, auth, status] of [
    [{}, "https://evil.test", "Bearer grove-user", 403],
    [{}, "https://grove.test", "", 401],
    [
      { action: "exchange", code: "code", verifier: "a".repeat(64), redirect: "https://evil.test" },
      "https://grove.test",
      "Bearer grove-user",
      400,
    ],
    [
      {
        action: "exchange",
        code: "code",
        redirect: "https://grove.test/grove/app/github-callback.html",
      },
      "https://grove.test",
      "Bearer grove-user",
      400,
    ],
  ] as const)
    expect((await handler(request(body, origin, auth))).status).toBe(status);
  expect(calls).toBe(0);
});
it("exchanges codes and refresh tokens only at fixed GitHub endpoints without returning the app secret", async () => {
  const calls: { url: string; body?: string }[] = [];
  const handler = githubAppHandler(config, {
    user: async () => "user",
    fetch: async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
      return Response.json(
        url.endsWith("/user")
          ? { id: 12, login: "github-user" }
          : {
              access_token: "ghu_fixture",
              refresh_token: "ghr_fixture012345",
              expires_in: 28800,
              refresh_token_expires_in: 15897600,
            },
      );
    },
  });
  for (const body of [
    {
      action: "exchange",
      code: "code",
      verifier: "v".repeat(64),
      redirect: "https://grove.test/grove/app/github-callback.html",
    },
    { action: "refresh", refreshToken: "ghr_fixture012345" },
  ]) {
    const response = await handler(request(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = await response.text();
    expect(text).not.toContain("server-secret");
    const value = JSON.parse(text);
    expect(value).toMatchObject({ token: "ghu_fixture", expiresIn: 28800 });
    // Only the first exchange looks up the account; a refresh returns the rotated tokens at once.
    if (body.action === "exchange") expect(value).toMatchObject({ id: "12", login: "github-user" });
    else expect(value.id).toBeUndefined();
  }
  expect(calls).toHaveLength(3);
  expect(
    calls.every((call) =>
      ["https://github.com/login/oauth/access_token", "https://api.github.com/user"].includes(
        call.url,
      ),
    ),
  ).toBe(true);
  expect(JSON.parse(calls[0].body!).client_secret).toBe("server-secret");
  expect(JSON.parse(calls[2].body!).grant_type).toBe("refresh_token");
});
it("rejects non-object request bodies as bad requests", async () => {
  const handler = githubAppHandler(config, {
    user: async () => "user",
    fetch: async () => Response.json({}),
  });
  for (const body of [null, 1, "x"]) expect((await handler(request(body))).status).toBe(400);
});
it("does not expose provider error payloads or secrets", async () => {
  const handler = githubAppHandler(config, {
    user: async () => "user",
    fetch: async () =>
      Response.json({ error: "bad_verification_code", error_description: "server-secret" }),
  });
  const response = await handler(request({ action: "refresh", refreshToken: "ghr_fixture012345" }));
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain("server-secret");
});
