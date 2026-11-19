import { useEffect, useRef } from "react";
import { captchaMessage, captchaPage } from "../auth-captcha";
import type { CaptchaProps } from "./Captcha.types";

export function Captcha({ url, attempt, dark, onToken }: CaptchaProps) {
  const page = captchaPage(url, attempt, dark);
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    onToken("");
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(page).origin)
        return;
      if (typeof event.data !== "string") return;
      const token = captchaMessage(event.data, attempt);
      if (token !== undefined) onToken(token);
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      onToken("");
    };
  }, [page, attempt, onToken]);
  return (
    <iframe
      ref={frame}
      src={page}
      title="Account verification"
      referrerPolicy="no-referrer"
      style={{ border: 0, width: "100%", height: 110 }}
    />
  );
}
