import { describe, expect, it } from "vite-plus/test";
import {
  captchaMessage,
  captchaNavigation,
  captchaPage,
  trustedCaptchaPage,
  trustedCaptchaSource,
} from "./auth-captcha";

describe("phone CAPTCHA boundary", () => {
  it("accepts Android origin-only bridge messages only on the exact current page", () => {
    const page = "https://grove.example/mobile-captcha.html?attempt=0&theme=light";
    expect(trustedCaptchaSource("https://grove.example", page, page)).toBe(true);
    expect(trustedCaptchaSource(page, page, page)).toBe(true);
    expect(trustedCaptchaSource("https://grove.example", "https://grove.example/other", page)).toBe(
      false,
    );
    expect(trustedCaptchaSource("https://challenges.cloudflare.com", page, page)).toBe(false);
    expect(trustedCaptchaSource("https://grove.example.evil", page, page)).toBe(false);
  });
  it("allows Android challenge frames without permitting arbitrary navigation", () => {
    const page = "https://grove.example/mobile-captcha.html?attempt=0&theme=light";
    expect(captchaNavigation(page, page, true)).toBe(true);
    expect(captchaNavigation("https://challenges.cloudflare.com/turnstile/frame", page)).toBe(true);
    expect(captchaNavigation("about:blank", page, false)).toBe(true);
    expect(captchaNavigation("https://challenges.cloudflare.com/turnstile/frame", page, true)).toBe(
      false,
    );
    for (const bad of [
      "https://challenges.cloudflare.com.evil/frame",
      "https://evil.example",
      "file:///etc/passwd",
      "grove://auth/callback",
    ])
      expect(captchaNavigation(bad, page)).toBe(false);
  });
  it("uses a fixed HTTPS widget page without credentials or fragments", () => {
    const page = captchaPage("https://grove.example/app/mobile-captcha.html", 3, true);
    expect(page).toBe("https://grove.example/app/mobile-captcha.html?attempt=3&theme=dark");
    for (const url of [
      "http://grove.example/a",
      "javascript:alert(1)",
      "https://u:p@grove.example/a",
      "https://grove.example/a#token",
      "https://grove.example/a?secret=1",
    ])
      expect(() => captchaPage(url, 0, false)).toThrow();
    expect(trustedCaptchaPage(page, page)).toBe(true);
    expect(
      trustedCaptchaPage("https://evil.example/app/mobile-captcha.html?attempt=3&theme=dark", page),
    ).toBe(false);
    expect(trustedCaptchaPage(page + "&redirect=evil", page)).toBe(false);
  });
  it("rejects stale, malformed and oversized messages and accepts token expiry", () => {
    const message = (token: unknown, attempt = 3) =>
      JSON.stringify({ type: "grove.captcha", attempt, token });
    expect(captchaMessage(message("verified"), 3)).toBe("verified");
    expect(captchaMessage(message(""), 3)).toBe("");
    for (const raw of [
      "bad",
      "null",
      message("stale", 2),
      message(4),
      message("x".repeat(2049)),
      JSON.stringify({ type: "other", attempt: 3, token: "fake" }),
    ])
      expect(captchaMessage(raw, 3)).toBeUndefined();
  });
});
