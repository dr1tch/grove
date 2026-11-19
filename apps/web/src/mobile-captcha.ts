// This page receives no account credentials, note content or session tokens.
const query = new URLSearchParams(location.search);
const attempt = Number(query.get("attempt"));
const dark = query.get("theme") === "dark";
document.body.classList.toggle("dark", dark);
const status = document.getElementById("status")!;
type Turnstile = {
  render(host: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
};
const host = window as unknown as {
  turnstile?: Turnstile;
  ReactNativeWebView?: { postMessage(message: string): void };
};
function send(token: string) {
  const message = JSON.stringify({ type: "grove.captcha", attempt, token });
  if (host.ReactNativeWebView) host.ReactNativeWebView.postMessage(message);
  else if (window.parent !== window) window.parent.postMessage(message, "*");
}
function failed(retry: () => void) {
  send("");
  status.textContent = "Verification failed. ";
  const button = document.createElement("button");
  button.textContent = "Try again";
  button.onclick = () => {
    status.textContent = "Loading account verification…";
    retry();
  };
  status.append(button);
}
const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
if (!sitekey || !query.has("attempt") || !Number.isSafeInteger(attempt) || attempt < 0) {
  status.textContent = "Account verification is not configured.";
} else {
  const load = () => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onerror = () =>
      failed(() => {
        script.remove();
        load();
      });
    script.onload = () => {
      if (!host.turnstile) return script.onerror?.(new Event("error"));
      const widget = host.turnstile.render(document.getElementById("widget")!, {
        sitekey,
        theme: dark ? "dark" : "light",
        size: "flexible",
        callback: (token: string) => {
          status.textContent = "Verified";
          send(token);
        },
        "expired-callback": () => {
          send("");
          status.textContent = "Verification expired. Complete it again.";
        },
        "error-callback": () => {
          failed(() => host.turnstile?.reset(widget));
        },
      });
    };
    document.head.append(script);
  };
  load();
}
