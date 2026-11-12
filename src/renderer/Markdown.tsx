import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { wikiToMarkdown } from "../shared/links";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
const markdownSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), "folio-note", "folio-drawing"],
  },
};
import { Workflow, ZoomIn, ZoomOut, Maximize2, X } from "lucide-react";
import type { Document } from "../shared/types";
import { CopyButton } from "./CopyButton";
import { DrawingEmbed } from "./DrawingEmbed";
import { kindOf } from "../shared/types";
import { Viewer } from "./Viewer";
function AttachmentEmbed({
  path,
  root,
  dark,
  open,
}: {
  path: string;
  root: string;
  dark: boolean;
  open: (path: string) => void;
}) {
  const kind = kindOf(path);
  const [size, setSize] = useState(0);
  useEffect(() => {
    let live = true;
    void window.folio
      .inspect(path)
      .then((entry) => live && setSize(entry.size))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <span className={`attachment-embed embed-${kind}`}>
      <button onClick={() => open(path)}>Open {path.split("/").pop()}</button>
      <span className="attachment-view">
        <Viewer
          entry={{ path, name: path.split("/").pop()!, kind, size, modified: 0 }}
          value=""
          onChange={() => {}}
          dark={dark}
          vaultRoot={root}
        />
      </span>
    </span>
  );
}
let diagramId = 0;
function Diagram({ source, dark }: { source: string; dark: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [availableWidth, setAvailableWidth] = useState(0);
  const type = /^\s*(?:flowchart|graph)\b/.test(source)
    ? "Flowchart"
    : source.trim().split(/[\s\n]/)[0] || "Diagram";
  useEffect(() => {
    if (expanded) {
      modal.current?.showModal();
      viewport.current?.scrollTo(0, 0);
    }
  }, [expanded]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setAvailableWidth(element.clientWidth));
    observer.observe(element);
    setAvailableWidth(element.clientWidth);
    return () => observer.disconnect();
  }, [expanded, show]);
  useEffect(() => {
    let live = true;
    void import("mermaid").then(async ({ default: m }) => {
      const styles = getComputedStyle(document.documentElement);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "Geist",
        themeVariables: {
          darkMode: dark,
          background: token("--surface"),
          primaryColor: dark ? "#263b33" : "#eff8f3",
          primaryTextColor: token("--text"),
          primaryBorderColor: dark ? "#52846c" : "#86b49c",
          lineColor: token("--muted"),
          secondaryColor: token("--code"),
          tertiaryColor: token("--surface"),
          clusterBkg: token("--code"),
          clusterBorder: token("--line2"),
          edgeLabelBackground: token("--surface"),
          fontFamily: "Geist",
          fontSize: "14px",
        },
        flowchart: {
          htmlLabels: false,
          curve: "basis",
          nodeSpacing: 50,
          rankSpacing: 65,
          padding: 20,
          diagramPadding: 28,
        },
        themeCSS:
          // Mermaid adds light grey drop-shadows to shapes, which look like a shine on dark themes.
          "* {filter: none !important;} .node rect {rx: 10px; ry: 10px;} .edgeLabel {font-size:12px;} .flowchart-link {stroke-width:1.5px;}",
      });
      try {
        const { svg } = await m.render(`folio-mermaid-${++diagramId}`, source);
        if (live && host.current) {
          host.current.innerHTML = svg;
          const width = host.current.querySelector("svg")?.viewBox.baseVal.width || 0;
          setNaturalWidth(Number.isFinite(width) ? width : 0);
          viewport.current?.scrollTo(0, 0);
          setError("");
        }
      } catch (e) {
        if (live) setError(String(e).split("\n")[0]);
      }
    });
    return () => {
      live = false;
    };
  }, [source, dark, show, expanded]);
  const content = (
    <>
      <header
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Workflow size={15} />
        <b>{type}</b>
        <span className="push" />
        <button onClick={() => setShow(!show)}>{show ? "Diagram" : "Source"}</button>
        <button
          aria-label="Zoom out diagram"
          disabled={show || zoom <= 0.5}
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          <ZoomOut size={14} />
        </button>
        <button className="diagram-fit" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button
          aria-label="Zoom in diagram"
          disabled={show || zoom >= 3}
          onClick={() => setZoom(Math.min(3, zoom + 0.25))}
        >
          <ZoomIn size={14} />
        </button>
        <CopyButton text={source} />
        <button
          aria-label={expanded ? "Close expanded diagram" : "Expand diagram"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <X size={14} /> : <Maximize2 size={14} />}
        </button>
      </header>
      {error && <p className="error-text">{error}</p>}
      {show || error ? (
        <pre>{source}</pre>
      ) : (
        <div className="diagram-viewport" ref={viewport}>
          <div
            className="mermaid"
            ref={host}
            style={{
              width:
                naturalWidth && availableWidth
                  ? `${Math.min(naturalWidth, Math.max(1, availableWidth - 56)) * zoom + 56}px`
                  : `${zoom * 100}%`,
              minWidth: 0,
            }}
          />
        </div>
      )}
    </>
  );
  return expanded ? (
    <dialog
      ref={modal}
      className="diagram-expanded"
      aria-label={`${type} diagram`}
      onCancel={(e) => {
        e.preventDefault();
        setExpanded(false);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            setExpanded(false);
        }
      }}
    >
      {content}
    </dialog>
  ) : (
    <div className="code-block diagram-block" data-export-ready={!!naturalWidth || !!error}>
      {content}
    </div>
  );
}

function Asset({ path, alt }: { path: string; alt?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let live = true;
    void window.folio
      .asset(path)
      .then((u) => {
        if (live) setUrl(u);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [path]);
  return url ? (
    <figure>
      <img src={url} alt={alt || path} />
      {alt && <figcaption>{alt}</figcaption>}
    </figure>
  ) : (
    <span className="muted">Image unavailable: {path}</span>
  );
}
function Code({ text, language, dark }: { text: string; language: string; dark: boolean }) {
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
    <div className="code-block" data-export-ready={ready}>
      <header>
        <b>{language || "Text"}</b>
        <span className="push" />
        <CopyButton text={text} />
      </header>
      {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <pre>{text}</pre>}
    </div>
  );
}
export function Markdown({
  doc,
  value,
  onChange,
  open,
  dark,
  vaultRoot,
}: {
  doc: Document;
  value: string;
  onChange: (s: string) => void;
  open: (path: string) => void;
  dark: boolean;
  vaultRoot?: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  // Parents pass new callback objects on every render (for example while saving scroll position).
  // Stable wrappers keep the rendered document cached, so diagrams and code blocks are not remounted.
  const callbacks = useRef({ open, onChange });
  callbacks.current = { open, onChange };
  const openPath = useCallback((path: string) => callbacks.current.open(path), []);
  const change = useCallback((next: string) => callbacks.current.onChange(next), []);
  useEffect(() => {
    const closeOutline = (event: PointerEvent) => {
      const outline = scroll.current?.querySelector(".document-outline");
      if (
        outline &&
        !outline.contains(event.target as Node) &&
        outline.contains(document.activeElement)
      )
        (document.activeElement as HTMLElement)?.blur();
    };
    document.addEventListener("pointerdown", closeOutline);
    return () => document.removeEventListener("pointerdown", closeOutline);
  }, []);
  const [active, setActive] = useState(0);
  const headings = [...value.matchAll(/^(#{1,3})\s+(.+)$/gm)].map((m, i) => ({
    level: m[1].length,
    title: m[2],
    id: `heading-${i}`,
  }));
  let heading = 0;
  const folder = doc.path.split("/").slice(0, -1).join("/");
  const resolve = (p: string) => {
    try {
      p = decodeURIComponent(p.split("#")[0]);
    } catch {
      return "";
    }
    const parts = (folder ? `${folder}/${p}` : p).split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        if (!normalized.length) return "";
        normalized.pop();
      } else if (part !== ".") normalized.push(part);
    }
    return normalized.join("/");
  };
  const transformed = wikiToMarkdown(value);
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (items) => {
        for (const item of items)
          if (item.isIntersecting) setActive(Number(item.target.id.replace("heading-", "")));
      },
      { root: el, rootMargin: "0px 0px -70% 0px" },
    );
    el.querySelectorAll("h1,h2,h3").forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [value]);
  const h = (level: 1 | 2 | 3, children: React.ReactNode) => {
    const id = `heading-${heading++}`;
    if (level === 1)
      return (
        <>
          <h1 id={id}>{children}</h1>
          <div className="meta">
            Edited {new Date(doc.modified).toLocaleDateString()}
            <span>·</span>
            {value.trim().split(/\s+/).length} words<span>·</span>
            {Math.max(1, Math.ceil(value.trim().split(/\s+/).length / 220))} min read
          </div>
        </>
      );
    return level === 2 ? <h2 id={id}>{children}</h2> : <h3 id={id}>{children}</h3>;
  };
  // Keep diagram controls mounted while the outline tracks scrolling.
  const renderedDocument = useMemo(
    () => (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, markdownSchema]]}
        urlTransform={(url) =>
          /^(https?:|mailto:|folio-note:|folio-drawing:)/i.test(url) || !url.includes(":")
            ? url
            : ""
        }
        components={{
          p: ({ children, node }) =>
            node?.children.some(
              (child) =>
                child.type === "element" &&
                child.tagName === "a" &&
                ["pdf", "video", "audio"].includes(kindOf(String(child.properties.href))),
            ) ? (
              <div className="attachment-paragraph">{children}</div>
            ) : (
              <p>{children}</p>
            ),
          h1: ({ children }) => h(1, children),
          h2: ({ children }) => h(2, children),
          h3: ({ children }) => h(3, children),
          a: ({ href, children }) =>
            href?.startsWith("folio-drawing:") ? (
              <DrawingEmbed path={resolve(href.slice(14))} dark={dark} open={openPath} />
            ) : href &&
              vaultRoot &&
              !/^(?:[a-z]+:|\/)/i.test(href) &&
              ["pdf", "video", "audio"].includes(kindOf(href)) ? (
              <AttachmentEmbed path={resolve(href)} root={vaultRoot} dark={dark} open={openPath} />
            ) : (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href?.startsWith("folio-")) {
                    const path = href.replace(/^folio-(note|drawing):/, "");
                    openPath(resolve(/\.[a-z]+$/i.test(path) ? path : `${path}.md`));
                  } else if (href && !/^[a-z]+:/i.test(href)) openPath(resolve(href));
                }}
              >
                {children}
              </a>
            ),
          img: ({ src, alt }) => <Asset path={resolve(String(src || ""))} alt={alt} />,
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }) => {
            const text = (typeof children === "string" ? children : "").replace(/\n$/, "");
            const language = className?.replace("language-", "") || "";
            if (language === "mermaid") return <Diagram source={text} dark={dark} />;
            if (className || (typeof children === "string" && children.endsWith("\n")))
              return <Code text={text} language={language} dark={dark} />;
            return <code {...props}>{children}</code>;
          },
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          li: ({ children, node, className }) => (
            <li
              className={className}
              onChange={(event) => {
                if (!(event.target instanceof HTMLInputElement)) return;
                event.stopPropagation();
                const index = (node?.position?.start.line || 1) - 1;
                const lines = value.split("\n");
                if (/^\s*[-*+]\s+\[[ xX]\]/.test(lines[index] || "")) {
                  lines[index] = lines[index].replace(
                    /\[([ xX])\]/,
                    event.target.checked ? "[x]" : "[ ]",
                  );
                  change(lines.join("\n"));
                }
              }}
            >
              {children}
            </li>
          ),
          input: ({ checked }) => (
            <input
              type="checkbox"
              checked={checked}
              aria-label={checked ? "Mark task incomplete" : "Complete task"}
              onChange={() => {}}
            />
          ),
        }}
      >
        {transformed}
      </ReactMarkdown>
    ),
    [doc.path, doc.modified, value, transformed, dark, vaultRoot, openPath, change],
  );
  return (
    <div className="preview" ref={scroll}>
      {headings.length >= 3 && (
        <nav className="document-outline" aria-label="Document outline">
          {headings.map((item, i) => (
            <button
              key={i}
              className={i === active ? "active" : ""}
              title={item.title}
              onClick={() =>
                scroll.current?.querySelector(`#${item.id}`)?.scrollIntoView({
                  behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                    ? "instant"
                    : "smooth",
                  block: "start",
                })
              }
            >
              <i style={{ width: 20 - item.level * 4 }} />
              <span>{item.title}</span>
            </button>
          ))}
        </nav>
      )}
      <article className="md">{renderedDocument}</article>
    </div>
  );
}
