import { Toggle } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import { ViewControls } from "./ViewControls";
export function CodeBlock({
  text,
  language,
  dark,
  edit,
  preview,
  sourceEditor,
  editLabel = "Edit",
  onPreview,
}: {
  text: string;
  language: string;
  dark: boolean;
  edit?: () => void;
  // Keep the element stable when asynchronous highlighting updates this block.
  preview?: ReactNode;
  sourceEditor?: ReactNode;
  editLabel?: string;
  onPreview?: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1),
    [fitWidth, setFitWidth] = useState(false),
    [fullscreen, setFullscreen] = useState(false),
    [viewError, setViewError] = useState("");
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === host.current);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const [html, setHtml] = useState("");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void import("shiki").then(async (s) => {
      try {
        const rendered = await s.codeToHtml(text, {
          lang: language || "text",
          theme: dark ? "github-dark" : "github-light",
        });
        if (live) setHtml(rendered);
      } catch {
        if (live) setHtml("");
      } finally {
        if (live) setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [text, language, dark]);
  return (
    <div ref={host} className="code-block" data-export-ready={ready}>
      <header>
        <b>{language || "Text"}</b>
        <span className="push" />
        {preview && (
          <Toggle.Root
            pressed={showPreview}
            onPressedChange={(pressed) => {
              setShowPreview(pressed);
              onPreview?.();
            }}
          >
            {showPreview ? "Source" : "Preview"}
          </Toggle.Root>
        )}
        {edit && <button onClick={edit}>{editLabel}</button>}
        <CopyButton text={text} />
      </header>
      <div className="code-content" data-fit-width={fitWidth || undefined} style={{ zoom }}>
        {sourceEditor ? (
          sourceEditor
        ) : showPreview && preview ? (
          preview
        ) : html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre>{text}</pre>
        )}
      </div>
      {viewError && (
        <p role="alert" className="code-block-error">
          {viewError}
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
          const element = host.current!;
          if (!element.requestFullscreen) {
            setViewError("Fullscreen is unavailable in this browser.");
            return;
          }
          void (
            document.fullscreenElement === element
              ? document.exitFullscreen()
              : element.requestFullscreen()
          ).catch(() => setViewError("Fullscreen is unavailable in this browser."));
        }}
      />
    </div>
  );
}
