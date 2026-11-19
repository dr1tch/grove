import { Tabs, ToggleGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { Entry, PaneState, Settings, ViewState } from "../shared/types";
import type { WorkingTab } from "../shared/recovery";
import { Editor } from "./Editor";
import { RichPreview } from "./RichPreview";
import { LiveNote } from "./LiveNote";
import { PreviewStyle } from "./PreviewStyle";
import type { PreviewStyleValue } from "./PreviewStyle";
import { TextPreview } from "./TextPreview";
import { Viewer } from "./Viewer";
import { HtmlPreview } from "./HtmlPreview";
import { FileIcon } from "./FileIcon";
import { Tooltip } from "./Tooltip";
import { ViewControls } from "./ViewControls";
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
  setPreviewStyle,
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
  setPreviewStyle: (value: PreviewStyleValue) => void;
}) {
  const host = useRef<HTMLElement>(null);
  const [pendingDrop, setPendingDrop] = useState<{
    stamp: number;
    anchor: number;
  }>();
  const [fullscreen, setFullscreen] = useState(false);
  const view = pane.views[pane.active] || { mode: tab?.mode || "preview" };
  const zoom = view.zoom ?? 1;
  useEffect(() => {
    const app = host.current!.closest<HTMLElement>(".app")!;
    const changed = () => {
      const owned = app.dataset.documentFullscreen === pane.id;
      const active = !!document.fullscreenElement && app.contains(document.fullscreenElement);
      setFullscreen(owned && active);
      if (owned && !active) delete app.dataset.documentFullscreen;
    };
    document.addEventListener("fullscreenchange", changed);
    return () => {
      document.removeEventListener("fullscreenchange", changed);
      if (app.dataset.documentFullscreen !== pane.id) return;
      delete app.dataset.documentFullscreen;
      if (document.fullscreenElement === app) void document.exitFullscreen().catch(() => {});
    };
  }, [pane.id]);
  const toggleFullscreen = () => {
    // Keep App-owned save/search dialogs inside the fullscreen element.
    const app = host.current!.closest<HTMLElement>(".app")!;
    if (!fullscreen) app.dataset.documentFullscreen = pane.id;
    const action = fullscreen ? document.exitFullscreen() : app.requestFullscreen();
    void action.catch(() => {
      delete app.dataset.documentFullscreen;
      notify("Fullscreen is unavailable. Try the window fullscreen control.");
    });
  };
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
    const content = element.querySelector(".live-preview .cm-content, .md");
    if (content) observer.observe(content);
    const scroll = (event: Event) => {
      if (
        event.target === element.querySelector(".preview, .text-preview-scroll") &&
        event.target instanceof Element
      )
        live.current.updateView(live.current.path, {
          previewScroll: event.target.scrollTop,
        });
    };
    element.addEventListener("scroll", scroll, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      element.removeEventListener("scroll", scroll, true);
    };
  }, [pane.active, view.mode]);
  return (
    <Tabs.Root value={pane.active} onValueChange={activate} asChild>
      <section
        ref={host}
        className={`document-pane ${focused ? "focused" : ""}`}
        data-pane={pane.id}
        data-document-fullscreen={fullscreen || undefined}
        onPointerDownCapture={focus}
        onFocusCapture={focus}
        onDragOver={(event) => {
          if (entry?.kind === "markdown" && event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (
            event.defaultPrevented ||
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
            <Tabs.List asChild>
              <nav className="pane-tabs" aria-label={`${pane.id} pane tabs`}>
                {pane.tabs.map((path) => (
                  <Tooltip key={path} text={label(path)}>
                    <Tabs.Trigger value={path} className={path === pane.active ? "active" : ""}>
                      <FileIcon path={path} />
                      <span>{label(path)}</span>
                    </Tabs.Trigger>
                  </Tooltip>
                ))}
              </nav>
            </Tabs.List>
            <button aria-label="Close pane" onClick={closePane}>
              ×
            </button>
          </header>
        )}
        <Tabs.Content value={pane.active} style={{ display: "contents" }}>
          {tab && entry ? (
            <>
              {(split || fullscreen) && ["markdown", "text"].includes(entry.kind) && (
                <ToggleGroup.Root
                  type="single"
                  className="pane-mode seg"
                  aria-label="Pane view mode"
                  value={view.mode}
                  onValueChange={(mode) => {
                    if (mode)
                      updateView(tab.path, {
                        mode: mode as ViewState["mode"],
                      });
                  }}
                >
                  {(["edit", "preview", "split"] as const).map((mode) => (
                    <ToggleGroup.Item
                      key={mode}
                      value={mode}
                      aria-label={mode[0].toUpperCase() + mode.slice(1)}
                      className={view.mode === mode ? "active" : ""}
                    >
                      {mode}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
              )}
              {tab.disk && !focused && (
                <p className="banner warning">
                  Changed on disk. Select this pane to resolve the conflict.
                </p>
              )}
              {["markdown", "text"].includes(entry.kind) ? (
                <div
                  className={`writing ${view.mode}`}
                  key={tab.path}
                  style={{ zoom }}
                  data-fit-width={view.fitWidth || undefined}
                >
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
                      settings.previewStyle === "live" ? (
                        <LiveNote
                          doc={tab.doc}
                          value={tab.value}
                          onChange={(value) => change(tab.path, value)}
                          open={open}
                          dark={dark}
                          vaultRoot={root}
                          cacheKey={`live:${root}:${pane.id}:${tab.path}`}
                          fontSize={settings.fontSize}
                          scroll={view.previewScroll ?? 0}
                          onScroll={(previewScroll) => updateView(tab.path, { previewScroll })}
                          notify={notify}
                          toolbarEnd={<PreviewStyle value="live" change={setPreviewStyle} />}
                        />
                      ) : (
                        <RichPreview
                          vaultRoot={root}
                          doc={tab.doc}
                          value={tab.value}
                          onChange={(value) => change(tab.path, value)}
                          open={open}
                          dark={dark}
                          initialScroll={view.previewScroll}
                          toolbarEnd={<PreviewStyle value="formatted" change={setPreviewStyle} />}
                        />
                      )
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
              {["markdown", "text"].includes(entry.kind) && (
                <ViewControls
                  zoom={zoom}
                  fitWidth={view.fitWidth === true}
                  fullscreen={fullscreen}
                  onZoom={(zoom) => updateView(tab.path, { zoom, fitWidth: false })}
                  onFit={() => updateView(tab.path, { zoom: 1, fitWidth: true })}
                  onFullscreen={toggleFullscreen}
                />
              )}
            </>
          ) : (
            <div className="empty">Choose a file from the sidebar.</div>
          )}
        </Tabs.Content>
      </section>
    </Tabs.Root>
  );
}
