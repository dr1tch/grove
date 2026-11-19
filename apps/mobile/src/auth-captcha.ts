export function captchaPage(base: string, attempt: number, dark: boolean): string {
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Verification requires a configured HTTPS Grove page.");
  url.searchParams.set("attempt", String(attempt));
  url.searchParams.set("theme", dark ? "dark" : "light");
  return url.href;
}

export function trustedCaptchaPage(actual: string, expected: string): boolean {
  return actual === expected;
}

export function trustedCaptchaSource(source: string, current: string, expected: string): boolean {
  return (
    trustedCaptchaPage(current, expected) &&
    (source === expected || source === new URL(expected).origin)
  );
}

export function captchaNavigation(actual: string, expected: string, isTopFrame?: boolean): boolean {
  if (trustedCaptchaPage(actual, expected)) return true;
  if (isTopFrame === true) return false;
  // Android WebView omits isTopFrame for navigation callbacks.
  return (
    actual === "about:blank" ||
    actual === "about:srcdoc" ||
    actual.startsWith("https://challenges.cloudflare.com/")
  );
}

export function captchaMessage(raw: string, attempt: number): string | undefined {
  if (raw.length > 4096) return;
  try {
    const value = JSON.parse(raw);
    if (
      value?.type === "grove.captcha" &&
      value.attempt === attempt &&
      typeof value.token === "string" &&
      value.token.length <= 2048
    )
      return value.token;
  } catch {
    // Untrusted WebView messages never become authentication errors or credentials.
  }
}
