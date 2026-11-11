import { useEffect, useRef, useState } from "react";
import { Copy, Check, TriangleAlert } from "lucide-react";
export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={`copy-button ${state}`}
      aria-label={
        state === "copied" ? "Copied" : state === "error" ? "Copy failed. Try again" : "Copy"
      }
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() =>
        void window.folio
          .copyText(text)
          .then(() => {
            clearTimeout(timer.current);
            setState("copied");
            timer.current = setTimeout(() => setState("idle"), 1800);
          })
          .catch(() => {
            setState("error");
            clearTimeout(timer.current);
            timer.current = setTimeout(() => setState("idle"), 3000);
          })
      }
    >
      {state === "copied" ? (
        <Check size={14} />
      ) : state === "error" ? (
        <TriangleAlert size={14} />
      ) : (
        <Copy size={14} />
      )}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "error" ? "Try again" : "Copy"}
      </span>
    </button>
  );
}
