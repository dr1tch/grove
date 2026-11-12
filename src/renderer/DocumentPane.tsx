import { useEffect, useRef, useState } from "react";
import type { Entry, PaneState, Settings, ViewState } from "../shared/types";
import type { WorkingTab } from "../shared/recovery";
import { Editor } from "./Editor";
import { Markdown } from "./Markdown";
import { TextPreview } from "./TextPreview";
import { Viewer } from "./Viewer";
import { HtmlPreview } from "./HtmlPreview";
import { FileIcon } from "./FileIcon";
import { Tooltip } from "./Tooltip";
export function DocumentPane({
  pane,
  tab,
  entry,
  settings,
  root,
  dark,
  focused,
  split,
  focus,
  activate,
  closePane,
  change,
  open,
  ask,
  updateView,
  label,
  notify,
}: {
  pane: PaneState;
  tab?: WorkingTab;
  entry?: Entry;
  settings: Settings;
  root: string;
  dark: boolean;
  focused: boolean;
  split: boolean;
  focus: () => void;
  activate: (path: string) => void;
  closePane: () => void;
  change: (path: string, value: string) => void;
  open: (path: string) => void;
  ask: (selection: string) => void;
  updateView: (path: string, view: Partial<ViewState>) => void;
  label: (path: string) => string;
  notify: (message: string) => void;
}) {
  const host = useRef<HTMLElement>(null);
  const [pendingDrop, setPendingDrop] = useState<{ stamp: number; anchor: number }>();
  const view = pane.views[pane.active] || { mode: tab?.mode || "preview" };
  const live = useRef({ updateView, path: pane.active, view });
  live.current = { updateView, path: pane.active, view };
  useEffect(() => {
    const element = host.current!;
    const restore = () => {
      const preview = element.querySelector<HTMLElement>(".preview, .text-preview-scroll");
      if (preview) preview.scrollTop = live.current.view.previewScroll || 0;
    };
    const frame = requestAnimationFrame(restore);
    const observer = new ResizeObserver(restore);
    const content = element.querySelector(".md");
    if (content) observer.observe(content);
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(".preview, .text-preview-scroll"))
        live.current.updateView(live.current.path, { previewScroll: event.target.scrollTop });
    };
    element.addEventListener("scroll", scroll, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scroll, true);
    };
  }, [pane.active, view.mode]);
  return (
    <section
      ref={host}
      className={`document-pane ${focused ? "focused" : ""}`}
      data-pane={pane.id}
      onPointerDownCapture={focus}
      onFocusCapture={focus}
      onDragOver={(event) => {
        if (entry?.kind === "markdown" && event.dataTransfer.types.includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (
          entry?.kind !== "markdown" ||
          !tab ||
          !event.dataTransfer.files.length ||
          view.mode !== "preview"
        )
          return;
        event.preventDefault();
        updateView(tab.path, { mode: "edit" });
        setPendingDrop({
          stamp: event.timeStamp,
          anchor: view.selection?.head ?? tab.value.length,
        });
      }}
    >
      {split && (
        <header className="pane-header">
          <nav className="pane-tabs" aria-label={`${pane.id} pane tabs`}>
            {pane.tabs.map((path) => (
              <Tooltip key={path} text={label(path)}>
                <button
                  className={path === pane.active ? "active" : ""}
                  onClick={() => activate(path)}
                >
                  <FileIcon path={path} />
                  <span>{label(path)}</span>
                </button>
              </Tooltip>
            ))}
          </nav>
          <button aria-label="Close pane" onClick={closePane}>
            ×
          </button>
        </header>
      )}
      {tab && entry ? (
        <>
          {split && ["markdown", "text"].includes(entry.kind) && (
            <div className="pane-mode seg">
              {(["edit", "preview", "split"] as const).map((mode) => (
                <button
                  key={mode}
                  aria-label={mode[0].toUpperCase() + mode.slice(1)}
                  className={view.mode === mode ? "active" : ""}
                  onClick={() => updateView(tab.path, { mode })}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
          {tab.disk && !focused && (
            <p className="banner warning">
              Changed on disk. Select this pane to resolve the conflict.
            </p>
          )}
          {["markdown", "text"].includes(entry.kind) ? (
            <div className={`writing ${view.mode}`} key={tab.path}>
              {view.mode !== "preview" && (
                <Editor
                  isMarkdown={entry.kind === "markdown"}
                  vaultRoot={root}
                  attachmentTarget={
                    entry.kind === "markdown" && !tab.path.startsWith("draft://")
                      ? { path: tab.path, root }
                      : undefined
                  }
                  pendingDrop={pendingDrop}
                  onDropHandled={() => setPendingDrop(undefined)}
                  notify={notify}
                  cacheKey={`${root}:${pane.id}:${tab.path}`}
                  value={tab.value}
                  onChange={(value) => change(tab.path, value)}
                  fontSize={settings.fontSize}
                  onAsk={ask}
                  position={view}
                  onPosition={(position) => updateView(tab.path, position)}
                />
              )}
              {view.mode !== "edit" &&
                (entry.kind === "markdown" ? (
                  <Markdown
                    vaultRoot={root}
                    doc={tab.doc}
                    value={tab.value}
                    onChange={(value) => change(tab.path, value)}
                    open={open}
                    dark={dark}
                  />
                ) : /\.(?:html?|xhtml)$/i.test(tab.path) ? (
                  <HtmlPreview path={tab.path} value={tab.value} root={root} />
                ) : (
                  <TextPreview path={tab.path} value={tab.value} dark={dark} />
                ))}
            </div>
          ) : (
            <Viewer
              key={tab.path}
              entry={entry}
              value={tab.value}
              onChange={(value) => change(tab.path, value)}
              dark={dark}
              vaultRoot={root}
              position={view}
              onPosition={(position) => updateView(tab.path, position)}
            />
          )}
        </>
      ) : (
        <div className="empty">Choose a file from the sidebar.</div>
      )}
    </section>
  );
}
