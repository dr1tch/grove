import { githubAppHandler } from "./handler.ts";
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
const supabase = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
Deno.serve(
  githubAppHandler(
    {
      clientId: Deno.env.get("GITHUB_APP_CLIENT_ID") ?? "",
      clientSecret: Deno.env.get("GITHUB_APP_CLIENT_SECRET") ?? "",
      webURLs: (Deno.env.get("GROVE_WEB_URLS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
    {
      async user(authorization) {
        const response = await fetch(`${supabase}/auth/v1/user`, {
          headers: { Authorization: authorization, apikey: anon },
          redirect: "error",
          cache: "no-store",
        });
        if (!response.ok) return;
        const value = await response.json();
        return typeof value.id === "string" ? value.id : undefined;
      },
    },
  ),
);
