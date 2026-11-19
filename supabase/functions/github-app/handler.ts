export type GitHubAppSettings = { clientId: string; clientSecret: string; webURLs: string[] };
export function githubAppHandler(
  settings: GitHubAppSettings,
  dependencies: {
    user: (authorization: string) => Promise<string | undefined>;
    fetch?: typeof fetch;
  },
) {
  const transport = dependencies.fetch ?? fetch;
  const callbacks = settings.webURLs.map((value) => new URL("github-callback.html", value).href);
  const origins = new Set(settings.webURLs.map((value) => new URL(value).origin));
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin") ?? "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      Vary: "Origin",
      ...(origins.has(origin)
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
          }
        : {}),
    };
    const reply = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers });
    if (!origins.has(origin)) return reply({ error: "Origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    try {
      const authorization = request.headers.get("authorization") ?? "";
      if (!authorization.startsWith("Bearer ") || !(await dependencies.user(authorization)))
        return reply({ error: "Sign in first" }, 401);
      if (!settings.clientId || !settings.clientSecret || !settings.webURLs.length)
        return reply({ error: "GitHub connections are not configured" }, 503);
      if (Number(request.headers.get("content-length")) > 16384)
        return reply({ error: "Request too large" }, 413);
      const raw = await request.text();
      if (raw.length > 16384) return reply({ error: "Request too large" }, 413);
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object")
        return reply({ error: "Invalid GitHub connection request" }, 400);
      let parameters: Record<string, string>;
      if (
        body.action === "exchange" &&
        typeof body.code === "string" &&
        body.code.length > 0 &&
        body.code.length <= 512 &&
        typeof body.verifier === "string" &&
        /^[A-Za-z0-9._~-]{43,128}$/.test(body.verifier) &&
        typeof body.redirect === "string" &&
        callbacks.includes(body.redirect)
      )
        parameters = { code: body.code, code_verifier: body.verifier, redirect_uri: body.redirect };
      else if (
        body.action === "refresh" &&
        typeof body.refreshToken === "string" &&
        /^ghr_[A-Za-z0-9_]{10,512}$/.test(body.refreshToken)
      )
        parameters = { grant_type: "refresh_token", refresh_token: body.refreshToken };
      else return reply({ error: "Invalid GitHub connection request" }, 400);
      const response = await transport("https://github.com/login/oauth/access_token", {
        method: "POST",
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: settings.clientId,
          client_secret: settings.clientSecret,
          ...parameters,
        }),
      });
      if (!response.ok) return reply({ error: "GitHub token exchange failed" }, 502);
      const tokens = await response.json();
      if (tokens.error)
        return reply(
          { error: "GitHub authorization expired or was rejected. Connect again." },
          400,
        );
      if (
        typeof tokens.access_token !== "string" ||
        !/^ghu_[A-Za-z0-9_]+$/.test(tokens.access_token) ||
        typeof tokens.refresh_token !== "string" ||
        !/^ghr_[A-Za-z0-9_]+$/.test(tokens.refresh_token) ||
        !Number.isSafeInteger(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        tokens.expires_in > 86400 ||
        !Number.isSafeInteger(tokens.refresh_token_expires_in) ||
        tokens.refresh_token_expires_in <= 0 ||
        tokens.refresh_token_expires_in > 366 * 86400
      )
        return reply({ error: "GitHub returned invalid credentials" }, 502);
      // Durations, not timestamps: the browser computes expiry on its own clock.
      const issued = {
        token: tokens.access_token,
        refresh: tokens.refresh_token,
        expiresIn: tokens.expires_in,
        refreshExpiresIn: tokens.refresh_token_expires_in,
      };
      // GitHub has already rotated the refresh token: return it now, since any later failure
      // here would discard the only working credentials. The browser keeps the known account.
      if (body.action === "refresh") return reply(issued);
      const user = await transport("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      });
      if (!user.ok) return reply({ error: "GitHub account could not be verified" }, 502);
      const profile = await user.json();
      if (
        !Number.isSafeInteger(profile.id) ||
        profile.id <= 0 ||
        typeof profile.login !== "string" ||
        !/^[a-z\d_-]+$/i.test(profile.login)
      )
        return reply({ error: "GitHub returned invalid account data" }, 502);
      return reply({ id: String(profile.id), login: profile.login, ...issued });
    } catch {
      return reply({ error: "GitHub connection could not complete. Try again." }, 502);
    }
  };
}
