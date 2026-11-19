import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import DOMPurify from "dompurify";
import mermaid from "mermaid";
import { Annotation, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
  redo,
  undo,
} from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { formatMarkdown } from "@grove/core/markdown-format";
import {
  MAX_DOCUMENT_LENGTH,
  validateHostMessage,
  type EditorMessage,
  type Identity,
} from "./protocol";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/source-serif-4/latin-400.css";
import "./styles.css";

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}
let identity: Identity | null = null;
let revision = 0;
let mode: "read" | "edit" = "read";
let dark = false;
let view: EditorView | null = null;
let lastCommand = -1;
const fromHost = Annotation.define<boolean>();
const editorHost = document.getElementById("editor")!;
const readerHost = document.getElementById("reader")!;
const reader = createRoot(readerHost);
function post(message: EditorMessage) {
  const raw = JSON.stringify(message);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(raw);
  else window.parent.postMessage(raw, "*");
}
function report(message: string) {
  if (identity) post({ type: "error", ...identity, message });
}
function acknowledge() {
  if (identity) post({ type: "ready", ...identity, revision });
}
let diagramSequence = 0;
function Diagram({ source, theme }: { source: string; theme: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    setError(false);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme ? "dark" : "neutral",
      fontFamily: "Geist",
      htmlLabels: false,
      look: "classic",
      secure: [
        "securityLevel",
        "startOnLoad",
        "maxTextSize",
        "suppressErrorRendering",
        "htmlLabels",
        "look",
      ],
      maxTextSize: 50000,
      suppressErrorRendering: true,
    });
    // Mermaid's parser/render queue is shared. Use unique IDs and ignore removed previews.
    void mermaid
      .render(`grove-diagram-${++diagramSequence}`, source)
      .then(({ svg }) => {
        if (alive && host.current) {
          const safe = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "script", "iframe"],
            FORBID_ATTR: ["onload", "onclick"],
          });
          host.current.innerHTML = safe;
        }
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, [source, theme]);
  return error ? (
    <figure className="diagram-error">
      <figcaption>Diagram preview unavailable. Source is preserved below.</figcaption>
      <pre>
        <code>{source}</code>
      </pre>
    </figure>
  ) : (
    <div ref={host} className="diagram" aria-label="Mermaid diagram" />
  );
}
function Reading({ value, theme }: { value: string; theme: boolean }) {
  return (
    <article className="reading">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ children, href }) => (
            <span className="note-link" role="link" aria-disabled="true" title={href}>
              {children}
            </span>
          ),
          img: ({ alt }) => (
            <span className="attachment-placeholder">
              Image: {alt || "Vault attachment"}. Open attachments from Files.
            </span>
          ),
          code: ({ children, className, ...props }) =>
            /\blanguage-mermaid\b/.test(className || "") ? (
              <Diagram
                source={(typeof children === "string" ? children : "").replace(/\n$/, "")}
                theme={theme}
              />
            ) : (
              <code className={className} {...props}>
                {children}
              </code>
            ),
          pre: ({ children }) => <div className="code-block">{children}</div>,
        }}
      >
        {value}
      </ReactMarkdown>
    </article>
  );
}
function renderReading() {
  if (view && mode === "read")
    reader.render(<Reading value={view.state.doc.toString()} theme={dark} />);
}
function appearance(nextMode: "read" | "edit", nextDark: boolean) {
  const enteringEdit = mode !== "edit" && nextMode === "edit";
  mode = nextMode;
  dark = nextDark;
  document.documentElement.classList.toggle("dark", dark);
  editorHost.hidden = mode !== "edit";
  readerHost.hidden = mode !== "read";
  renderReading();
  if (enteringEdit) view?.focus();
}
function makeEditor(value: string) {
  view?.destroy();
  view = new EditorView({
    parent: editorHost,
    state: EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        lineNumbers(),
        syntaxHighlighting(
          HighlightStyle.define([
            { tag: tags.keyword, color: "var(--syntax-keyword)" },
            { tag: tags.string, color: "var(--syntax-code)" },
            { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
            { tag: tags.number, color: "var(--syntax-number)" },
            {
              tag: tags.function(tags.variableName),
              color: "var(--syntax-function)",
            },
            { tag: tags.typeName, color: "var(--syntax-heading)" },
            {
              tag: tags.heading,
              color: "var(--syntax-heading)",
              fontWeight: "600",
            },
            { tag: tags.monospace, color: "var(--syntax-code)" },
            { tag: tags.link, color: "var(--syntax-heading)" },
            { tag: tags.url, color: "var(--muted)" },
            { tag: tags.emphasis, fontStyle: "italic" },
            { tag: tags.strong, fontWeight: "700" },
            { tag: tags.list, color: "var(--syntax-list)" },
          ]),
        ),
        EditorView.lineWrapping,
        EditorState.transactionFilter.of((transaction) =>
          transaction.newDoc.length <= MAX_DOCUMENT_LENGTH ? transaction : [],
        ),
        EditorView.updateListener.of((update) => {
          if (
            !update.docChanged ||
            update.transactions.every((transaction) => transaction.annotation(fromHost))
          )
            return;
          if (!identity) return;
          revision += 1;
          const selection = update.state.selection.main;
          post({
            type: "change",
            ...identity,
            revision,
            value: update.state.doc.toString(),
            selection: { anchor: selection.anchor, head: selection.head },
          });
          renderReading();
        }),
        EditorView.contentAttributes.of({
          "aria-label": "Markdown source",
          autocapitalize: "sentences",
          spellcheck: "true",
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "15px",
            backgroundColor: "transparent",
            color: "var(--ink)",
          },
          ".cm-scroller": {
            fontFamily: "'JetBrains Mono', monospace",
            overflow: "auto",
            lineHeight: "1.7",
          },
          ".cm-content": {
            padding: "16px 18px 120px 0",
            caretColor: "var(--accent)",
          },
          ".cm-line": { padding: 0 },
          ".cm-focused": { outline: "none" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
            background: "var(--selection) !important",
          },
          ".cm-cursor": { borderLeftColor: "var(--accent)" },
          ".cm-gutters": {
            backgroundColor: "transparent",
            border: "none",
            color: "var(--muted)",
            minWidth: "44px",
          },
          ".cm-lineNumbers .cm-gutterElement": {
            padding: "0 12px 0 8px",
            minWidth: "44px",
          },
        }),
      ],
    }),
  });
}
function receive(raw: unknown) {
  const message = validateHostMessage(raw);
  if (!message) return;
  if (message.type === "probe") {
    if (identity) acknowledge();
    else post({ type: "boot", protocol: 1 });
    return;
  }
  if (message.type === "initialize") {
    if (
      identity &&
      message.session === identity.session &&
      message.documentId === identity.documentId
    ) {
      acknowledge();
      return;
    }
    identity = { documentId: message.documentId, session: message.session };
    revision = message.revision;
    lastCommand = -1;
    makeEditor(message.value);
    appearance(message.mode, message.dark);
    acknowledge();
    return;
  }
  if (
    !identity ||
    message.documentId !== identity.documentId ||
    message.session !== identity.session ||
    !view
  )
    return;
  if (message.type === "appearance") {
    appearance(message.mode, message.dark);
    return;
  }
  if (message.type === "replace") {
    identity = { ...identity, session: message.nextSession };
    const selection = view.state.selection.main;
    revision = message.revision;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: message.value },
      selection: EditorSelection.range(
        Math.min(selection.anchor, message.value.length),
        Math.min(selection.head, message.value.length),
      ),
      annotations: [fromHost.of(true), Transaction.addToHistory.of(false)],
    });
    renderReading();
    acknowledge();
    return;
  }
  if (message.type === "command") {
    const { command } = message;
    if (command.id <= lastCommand || mode !== "edit") return;
    lastCommand = command.id;
    if (command.action === "undo") undo(view);
    else if (command.action === "redo") redo(view);
    else {
      const { from, to } = view.state.selection.main;
      const edit =
        command.action === "insert"
          ? {
              changes: [{ from, to, insert: command.text! }],
              selection: {
                anchor: from + command.text!.length,
                head: from + command.text!.length,
              },
            }
          : formatMarkdown(view.state.doc.toString(), from, to, command.action);
      const nextSize =
        view.state.doc.length +
        edit.changes.reduce(
          (size, change) => size + change.insert.length - (change.to - change.from),
          0,
        );
      if (nextSize > MAX_DOCUMENT_LENGTH) {
        report("This insertion would exceed the phone editor size limit.");
        return;
      }
      view.dispatch({
        ...edit,
        annotations: [Transaction.userEvent.of("input.format"), isolateHistory.of("full")],
        scrollIntoView: true,
      });
    }
    view.focus();
  }
}
// Native WebView uses window; older Android implementations can dispatch on document.
window.addEventListener("message", (event) => {
  if (!window.ReactNativeWebView && event.source !== window.parent) return;
  receive(event.data);
});
document.addEventListener("message", ((event: MessageEvent) =>
  receive(event.data)) as EventListener);
document.addEventListener(
  "click",
  (event) => {
    if ((event.target as Element).closest?.("a")) event.preventDefault();
  },
  true,
);
window.addEventListener("error", () =>
  report("The document preview encountered an error. Your source is preserved."),
);
window.addEventListener("unhandledrejection", () =>
  report("The document preview could not finish. Your source is preserved."),
);
post({ type: "boot", protocol: 1 });
