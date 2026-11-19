import { ToggleGroup } from "radix-ui";
import { Dialog } from "./Dialog";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Editor, forgetEditor } from "./Editor";
import { ViewControls } from "./ViewControls";
export function CodeBlockDialog({
  source,
  language,
  renderPreview,
  apply,
  close,
}: {
  source: string;
  language: string;
  renderPreview: (value: string, navigationBlocked: () => void) => ReactNode;
  apply: (value: string) => void;
  close: () => void;
}) {
  const workspace = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(source),
    [mode, setMode] = useState<"edit" | "preview">("edit"),
    [zoom, setZoom] = useState(1),
    [fitWidth, setFitWidth] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [error, setError] = useState("");
  const cacheKey = useRef(`embedded-${crypto.randomUUID()}.${language || "txt"}`);
  useEffect(() => {
    if (value === source) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
      setError("Apply or cancel your block edits before closing or reloading.");
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [value, source]);
  const commit = () => {
    try {
      apply(value);
      close();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update the block");
    }
  };
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === workspace.current);
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      // Child editors cache on unmount; discard this temporary history after their cleanup.
      queueMicrotask(() => forgetEditor(cacheKey.current));
    };
  }, []);
  return (
    <Dialog
      className="code-block-dialog"
      label="Edit embedded block"
      close={() => {
        if (value !== source)
          setError("Use Apply to keep your changes, or Cancel to discard them.");
        else close();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          commit();
        }
        if ((event.ctrlKey || event.metaKey) && ["w", "n", "q"].includes(event.key.toLowerCase())) {
          event.preventDefault();
          setError("Apply or cancel your block edits before leaving the editor.");
        }
      }}
    >
      <div className="code-workspace" ref={workspace}>
        <header>
          <strong>{language || "Text"} block</strong>
          <span className="push" />
          <ToggleGroup.Root
            type="single"
            className="seg"
            aria-label="Embedded block mode"
            value={mode}
            onValueChange={(value) => {
              if (value) setMode(value as "edit" | "preview");
            }}
          >
            {(["edit", "preview"] as const).map((next) => (
              <ToggleGroup.Item key={next} value={next} className={mode === next ? "active" : ""}>
                {next === "edit" ? "Edit" : "Preview"}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </header>
        <div
          className="code-workspace-content"
          data-fit-width={fitWidth || undefined}
          style={{ zoom }}
        >
          {mode === "edit" ? (
            <Editor
              cacheKey={cacheKey.current}
              value={value}
              onChange={setValue}
              fontSize={14}
              isMarkdown={/^(md|markdown)$/i.test(language)}
            />
          ) : (
            renderPreview(value, () =>
              setError("Apply or cancel your block edits before opening another note."),
            )
          )}
        </div>
        {error && (
          <p className="code-block-error" role="alert">
            {error}
          </p>
        )}
        <ViewControls
          label="Embedded block view"
          zoom={zoom}
          fitWidth={fitWidth}
          fullscreen={fullscreen}
          onZoom={(next) => {
            setZoom(next);
            setFitWidth(false);
          }}
          onFit={() => {
            setZoom(1);
            setFitWidth(true);
          }}
          onFullscreen={() => {
            const element = workspace.current!;
            if (!element.requestFullscreen) {
              setError("Fullscreen is unavailable in this browser.");
              return;
            }
            void (
              document.fullscreenElement === element
                ? document.exitFullscreen()
                : element.requestFullscreen()
            ).catch(() => setError("Fullscreen is unavailable in this browser."));
          }}
        />
        <footer>
          <span>Apply changes only this block in your note.</span>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={commit}>
            Apply
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
