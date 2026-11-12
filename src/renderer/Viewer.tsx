import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FolderOpen,
  FileX,
  Minus,
  Plus,
  Maximize,
  Minimize,
  Scan,
  Maximize2,
  Minimize2,
  Play,
} from "lucide-react";
import { Tooltip } from "./Tooltip";
import { PdfSearch } from "./PdfSearch";
import {
  AudioPlayer,
  handleMediaKey,
  PlayerControls,
  togglePlay,
  useMediaState,
} from "./MediaPlayer";
import type { Entry, PreviewInfo, ViewState } from "../shared/types";
import * as pdfjs from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;
const Drawing = lazy(() => import("./Drawing"));
function DocumentPreview({
  url,
  image,
  video,
  onMediaError,
  onExpand,
  standalone = false,
  position,
  onPosition,
}: {
  url: string;
  image?: string;
  video?: string;
  onMediaError?: () => void;
  onExpand?: () => Promise<void>;
  standalone?: boolean;
  position?: ViewState;
  onPosition?: (position: Partial<ViewState>) => void;
}) {
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [pdfViewport, setPdfViewport] = useState<ReturnType<pdfjs.PDFPageProxy["getViewport"]>>();
  const [page, setPage] = useState(position?.page || 1);
  useEffect(() => {
    if (position?.find?.page) setPage(position.find.page);
  }, [position?.find?.id]);
  const [scale, setScale] = useState(position?.media?.scale || 1);
  const [fit, setFit] = useState(position?.media?.fit ?? true);
  const initial = useRef(position);
  const restored = useRef(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [renderedScale, setRenderedScale] = useState(1);
  const [mediaSize, setMediaSize] = useState({ width: 0, height: 0 });
  const media = image || video;
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    left: number;
    top: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);
  const suppressClick = useRef(false);
  const shell = useRef<HTMLElement>(null);
  const player = useRef<HTMLVideoElement>(null);
  const playback = useMediaState(player);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [idle, setIdle] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", change);
    return () => {
      document.removeEventListener("fullscreenchange", change);
      clearTimeout(hideTimer.current);
      clearTimeout(clickTimer.current);
    };
  }, []);
  // Controls hide after 3 s of no pointer movement while a video plays, like the reference player.
  const wake = () => {
    setIdle(false);
    clearTimeout(hideTimer.current);
    if (playback.playing) hideTimer.current = setTimeout(() => setIdle(true), 3000);
  };
  useEffect(() => {
    if (!playback.playing) {
      clearTimeout(hideTimer.current);
      setIdle(false);
    } else if (video) hideTimer.current = setTimeout(() => setIdle(true), 3000);
  }, [playback.playing]);
  const toggleFullscreen = () =>
    void (
      document.fullscreenElement ? document.exitFullscreen() : shell.current?.requestFullscreen()
    )?.catch(() => {});
  const fitScale = mediaSize.width
    ? Math.max(0.01, Math.min(size.width / mediaSize.width, size.height / mediaSize.height))
    : 1;
  const mediaScale = fit ? fitScale : scale;
  const zoom = media ? mediaScale : renderedScale;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    if (!(media ? mediaSize.width : pdf)) return;
    const element = view.current!;
    const frame = requestAnimationFrame(() => {
      if (!restored.current) {
        element.scrollTo(
          initial.current?.media?.scrollLeft || 0,
          initial.current?.media?.scrollTop || 0,
        );
        restored.current = true;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [media, mediaSize, pdf, renderedScale]);
  useEffect(() => {
    if (restored.current)
      onPosition?.({
        page,
        media: {
          fit,
          scale: zoom,
          scrollLeft: view.current?.scrollLeft || 0,
          scrollTop: view.current?.scrollTop || 0,
        },
      });
  }, [page, fit, zoom]);
  useEffect(() => {
    if (!media) return;
    const element = view.current!;
    const wheel = (event: WheelEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest("img, video") ||
        !event.deltaY
      )
        return;
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      const next = Math.max(
        0.01,
        Math.min(
          Math.max(3, fitScale),
          zoomRef.current * Math.exp(-Math.max(-200, Math.min(200, delta)) * 0.002),
        ),
      );
      zoomRef.current = next;
      setFit(false);
      setScale(next);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [media, fitScale]);
  const [error, setError] = useState("");
  const [openError, setOpenError] = useState("");
  useEffect(() => {
    if (!standalone) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.folio.closePreview();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [standalone]);
  useEffect(() => {
    const element = view.current!;
    const observer = new ResizeObserver(() =>
    // Fit inside the content box, so the CSS padding (large in tabs, none in note embeds) decides the margin.
    {
      const style = getComputedStyle(element);
      setSize({
        width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height:
          element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (media) return;
    const task = pdfjs.getDocument({ url });
    void task.promise.then(setPdf).catch((e) => setError(String(e)));
    return () => {
      void task.destroy();
    };
  }, [url, media]);
  useEffect(() => {
    if (!pdf) return;
    if (page > pdf.numPages) {
      setPage(pdf.numPages);
      return;
    }
    let cancelled = false;
    let render: pdfjs.RenderTask | undefined;
    void pdf
      .getPage(page)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const base = p.getViewport({ scale: 1.4 });
        const zoom = fit
          ? Math.max(0.01, Math.min(size.width / base.width, size.height / base.height))
          : scale;
        const viewport = p.getViewport({ scale: zoom * 1.4 });
        setPdfViewport(viewport);
        setRenderedScale(zoom);
        const c = canvas.current;
        c.width = viewport.width;
        c.height = viewport.height;
        render = p.render({ canvas: c, viewport });
        return render.promise;
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, page, scale, fit, size]);
  useEffect(() => {
    view.current?.scrollTo(0, 0);
  }, [page, fit]);
  return (
    <section
      ref={shell}
      className={`pdf-shell${video ? " video-shell" : ""}${video && idle ? " controls-idle" : ""}`}
      aria-label={video ? "Video viewer" : image ? "Image viewer" : "PDF viewer"}
      tabIndex={video ? 0 : undefined}
      onKeyDown={
        video ? (event) => handleMediaKey(event, player.current, toggleFullscreen) : undefined
      }
      onPointerMove={video ? wake : undefined}
      onFocus={video ? wake : undefined}
    >
      <div
        ref={view}
        onScroll={(event) => {
          if (restored.current)
            onPosition?.({
              page,
              media: {
                fit,
                scale: zoom,
                scrollLeft: event.currentTarget.scrollLeft,
                scrollTop: event.currentTarget.scrollTop,
              },
            });
        }}
        className={`${video ? "video-view" : image ? "image-view" : "pdf-view"}${media && (mediaSize.width * mediaScale > size.width || mediaSize.height * mediaScale > size.height) ? " pannable" : ""}${dragging ? " panning" : ""}`}
        onPointerDown={(event) => {
          suppressClick.current = false;
          if (
            !media ||
            event.button !== 0 ||
            !(event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement)
          )
            return;
          const element = event.currentTarget;
          if (
            element.scrollWidth <= element.clientWidth &&
            element.scrollHeight <= element.clientHeight
          )
            return;
          suppressClick.current = false;
          pan.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
            moved: false,
          };
          event.target.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = pan.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          start.moved = true;
          suppressClick.current = true;
          setDragging(true);
          event.currentTarget.scrollTo(start.left - dx, start.top - dy);
        }}
        onPointerUp={(event) => {
          if (event.target instanceof Element && event.target.hasPointerCapture(event.pointerId))
            event.target.releasePointerCapture(event.pointerId);
          pan.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          // A cancelled drag must not turn into a click (which would toggle video playback).
          pan.current = null;
          setDragging(false);
        }}
        onLostPointerCapture={() => {
          pan.current = null;
          setDragging(false);
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}
        onDoubleClick={(event) => {
          if (
            !(event.target instanceof HTMLImageElement || event.target instanceof HTMLVideoElement)
          )
            return;
          clearTimeout(clickTimer.current);
          event.preventDefault();
          event.stopPropagation();
          setFit(true);
          event.currentTarget.scrollTo(0, 0);
        }}
      >
        <div className="preview-stage">
          {video ? (
            <video
              ref={player}
              src={url}
              preload="metadata"
              onClick={(event) => {
                if (event.detail > 1) return;
                const element = event.currentTarget;
                // Delay so a double-click (fit) does not also toggle playback.
                clickTimer.current = setTimeout(() => togglePlay(element), 220);
              }}
              aria-label={video}
              onError={onMediaError}
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setMediaSize({ width: video.videoWidth, height: video.videoHeight });
              }}
              style={{
                width: mediaSize.width * mediaScale || undefined,
                height: mediaSize.height * mediaScale || undefined,
              }}
            />
          ) : image ? (
            <img
              draggable={false}
              src={url}
              alt={image}
              onError={onMediaError}
              onLoad={(event) => {
                const img = event.currentTarget;
                setMediaSize({ width: img.naturalWidth, height: img.naturalHeight });
              }}
              style={{
                width: mediaSize.width * mediaScale || undefined,
                height: mediaSize.height * mediaScale || undefined,
              }}
            />
          ) : error ? (
            <p className="banner danger">{error}</p>
          ) : (
            <div className="pdf-page">
              <canvas ref={canvas} />
              {pdf && pdfViewport && position?.find && (
                <PdfSearch pdf={pdf} page={page} viewport={pdfViewport} find={position.find} />
              )}
            </div>
          )}
        </div>
      </div>
      {openError && (
        <p className="banner danger" role="alert">
          {openError}
        </p>
      )}
      {video && (
        <>
          {!playback.playing && !playback.waiting && (
            // Visual cue only: clicks and wheel zoom pass through to the video underneath.
            <span className="video-big-play" aria-hidden="true">
              <Play fill="currentColor" />
            </span>
          )}
          {playback.waiting && (
            <span className="video-spinner" role="status" aria-label="Loading" />
          )}
          <PlayerControls media={player} className="video">
            <button
              aria-label="Zoom out"
              onClick={() => {
                setFit(false);
                setScale(Math.max(media ? 0.01 : 0.1, zoom - 0.1));
              }}
            >
              <Minus />
            </button>
            <span>{Math.round(zoom * 100)}%</span>
            <button
              aria-label="Zoom in"
              onClick={() => {
                setFit(false);
                setScale(Math.min(media ? Math.max(3, fitScale) : 3, zoom + 0.1));
              }}
            >
              <Plus />
            </button>

            <Tooltip text="Fit to window">
              <button
                aria-label="Fit to window"
                aria-pressed={fit}
                disabled={media ? !mediaSize.width : !pdf}
                onClick={() => setFit(true)}
              >
                <Scan />
              </button>
            </Tooltip>
            <Tooltip text={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}>
              <button
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={toggleFullscreen}
              >
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
              </button>
            </Tooltip>
          </PlayerControls>
        </>
      )}
      {!video && (
        <div className="pdf-controls">
          {!media && (
            <>
              <button
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                ‹
              </button>
              <span>
                {page} / {pdf?.numPages || "…"}
              </span>
              <button
                aria-label="Next page"
                disabled={!pdf || page >= pdf.numPages}
                onClick={() => setPage(page + 1)}
              >
                ›
              </button>
              <span className="divider" />
            </>
          )}
          <button
            aria-label="Zoom out"
            onClick={() => {
              setFit(false);
              setScale(Math.max(media ? 0.01 : 0.1, zoom - 0.1));
            }}
          >
            <Minus />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => {
              setFit(false);
              setScale(Math.min(media ? Math.max(3, fitScale) : 3, zoom + 0.1));
            }}
          >
            <Plus />
          </button>
          <span className="divider" />
          <Tooltip text="Fit to window">
            <button
              aria-label="Fit to window"
              aria-pressed={fit}
              disabled={media ? !mediaSize.width : !pdf}
              onClick={() => setFit(true)}
            >
              <Scan />
            </button>
          </Tooltip>
          {!video && (
            <Tooltip text={standalone ? "Close viewer (Esc)" : "Open in separate window"}>
              <button
                aria-label={standalone ? "Close viewer" : "Full window"}
                onClick={() =>
                  void (standalone ? window.folio.closePreview() : onExpand?.())?.catch((e) =>
                    setOpenError(String(e)),
                  )
                }
              >
                {standalone ? <Minimize /> : <Maximize />}
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </section>
  );
}
export function StandaloneViewer() {
  const [info, setInfo] = useState<PreviewInfo>();
  const [error, setError] = useState("");
  useEffect(() => {
    void window.folio
      .previewInfo()
      .then((info) => {
        document.documentElement.dataset.theme = info.theme;
        document.documentElement.dataset.accent = info.accent;
        setInfo(info);
      })
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <div className="standalone-viewer">
      {info ? (
        <DocumentPreview
          url={info.url}
          image={info.image}
          standalone
          onMediaError={() => setError("This image cannot be decoded.")}
        />
      ) : null}
      {error && <p className="banner danger">{error}</p>}
    </div>
  );
}
export function Viewer({
  entry,
  value,
  onChange,
  dark,
  vaultRoot,
  position,
  onPosition,
}: {
  entry: Entry;
  value: string;
  onChange: (s: string) => void;
  dark: boolean;
  vaultRoot: string;
  position?: ViewState;
  onPosition?: (position: Partial<ViewState>) => void;
}) {
  const [url, setUrl] = useState("");
  const [assetError, setAssetError] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    setAssetError("");
    void window.folio
      .asset(entry.path)
      .then((url) => {
        if (active) setUrl(url);
      })
      .catch((e) => {
        if (active) setAssetError(String(e));
      });
    return () => {
      active = false;
    };
  }, [entry.path]);
  if (entry.kind === "drawing")
    return (
      <Suspense fallback={<div className="empty">Opening drawing…</div>}>
        <Drawing value={value} onChange={onChange} dark={dark} />
      </Suspense>
    );
  return (
    <div className="viewer">
      <div className="file-strip">
        <span className="badge">
          {["audio", "video"].includes(entry.kind)
            ? "Plays in app"
            : entry.kind === "unsupported"
              ? "Not supported"
              : "Preview only"}
        </span>
        <span>
          {entry.kind === "pdf" ? "PDF" : entry.name.split(".").pop()?.toUpperCase()} ·{" "}
          {(entry.size / 1024).toFixed(1)} KB · original file is never modified
        </span>
        <button className="push" onClick={() => void window.folio.external(entry.path)}>
          <ExternalLink /> Open externally
        </button>
      </div>
      {assetError && (
        <div className="empty">
          <h2>Preview unavailable</h2>
          <p>{assetError}</p>
          <button className="primary" onClick={() => void window.folio.external(entry.path)}>
            Open externally
          </button>
        </div>
      )}
      {url &&
        (entry.kind === "pdf" || entry.kind === "office" ? (
          <DocumentPreview
            key={url}
            position={position}
            onPosition={onPosition}
            url={url}
            onExpand={() => window.folio.openPreview(entry.path, vaultRoot)}
          />
        ) : entry.kind === "image" ? (
          <DocumentPreview
            key={url}
            position={position}
            onPosition={onPosition}
            url={url}
            image={entry.name}
            onExpand={() => window.folio.openPreview(entry.path, vaultRoot)}
            onMediaError={() => {
              setUrl("");
              setAssetError("This image format cannot be decoded. Open it externally.");
            }}
          />
        ) : entry.kind === "audio" ? (
          <div className="empty audio-stage">
            <AudioPlayer
              key={url}
              url={url}
              name={entry.name}
              onError={() => {
                setUrl("");
                setAssetError("This media codec is not supported. Open it externally.");
              }}
            />
          </div>
        ) : entry.kind === "video" ? (
          <DocumentPreview
            key={url}
            position={position}
            onPosition={onPosition}
            url={url}
            video={entry.name}
            onMediaError={() => {
              setUrl("");
              setAssetError("This media codec is not supported. Open it externally.");
            }}
          />
        ) : (
          <div className="empty">
            <div className="file-tile">
              <FileX size={32} />
            </div>
            <span className="badge">Not supported</span>
            <h2>Open {entry.name} externally</h2>
            <p className="muted">{`Grove cannot preview .${entry.name.split(".").pop()} files.`}</p>
            <div className="actions">
              <button className="primary" onClick={() => void window.folio.external(entry.path)}>
                <ExternalLink /> Open externally
              </button>
              <button onClick={() => void window.folio.external(entry.path, true)}>
                <FolderOpen /> Show in Files
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
