import { useEffect, useRef } from "react";
import { EditorState, StateEffect, Annotation, Compartment, StateField } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  Decoration,
} from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { markdown } from "@codemirror/lang-markdown";
import { history, historyKeymap, defaultKeymap, isolateHistory } from "@codemirror/commands";
import { attachmentMarkdown } from "../shared/attachments";
import type { AttachmentResult } from "../shared/types";
import { textMatches } from "../shared/search";
const searchQuery = StateEffect.define<string>();
const searchHighlights = StateField.define({
  create: () => ({ query: "", ranges: Decoration.none }),
  update(value, transaction) {
    const query =
      transaction.effects.find((effect) => effect.is(searchQuery))?.value ?? value.query;
    return transaction.docChanged || query !== value.query
      ? {
          query,
          ranges: Decoration.set(
            textMatches(transaction.state.doc.toString(), query).map((hit) =>
              Decoration.mark({ class: "cm-search-hit" }).range(hit.from, hit.to),
            ),
          ),
        }
      : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.ranges),
});
import { syntaxHighlighting, HighlightStyle, LanguageDescription } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { ViewState } from "../shared/types";
const fromApp = Annotation.define<boolean>();
const cached = new Map<string, { state: EditorState; scroll: number }>();
export function Editor({
  value,
  onChange,
  fontSize,
  onAsk,
  cacheKey,
  position,
  onPosition,
  attachmentTarget,
  pendingDrop,
  onDropHandled,
  notify,
}: {
  cacheKey: string;
  value: string;
  onChange: (text: string) => void;
  fontSize: number;
  onAsk: (selection: string) => void;
  position?: ViewState;
  onPosition?: (position: Partial<ViewState>) => void;
  attachmentTarget?: { path: string; root: string };
  pendingDrop?: { stamp: number; anchor: number };
  onDropHandled?: () => void;
  notify?: (message: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onAsk, onPosition });
  callbacks.current = { onChange, onAsk, onPosition };
  const [line, setLine] = useLine();
  const anchors = useRef(new Map<string, number>());
  async function attach(load: () => Promise<AttachmentResult>, at?: number) {
    const editor = view.current,
      target = attachmentTarget;
    if (!editor || !target) return;
    const id = crypto.randomUUID();
    anchors.current.set(id, at ?? editor.state.selection.main.head);
    try {
      const result = await load();
      const anchor = anchors.current.get(id);
      if (view.current !== editor || anchor === undefined) {
        if (result.attachments.length)
          notify?.("Attachments saved, but the note was closed. No text was inserted.");
        return;
      }
      const insert = result.attachments
        .map((ref) => attachmentMarkdown(target.path, ref))
        .join("\n\n");
      if (insert)
        editor.dispatch({
          changes: { from: anchor, insert: `\n${insert}\n` },
          annotations: isolateHistory.of("full"),
        });
      if (result.failures.length)
        notify?.(result.failures.map((f) => `${f.name}: ${f.error}`).join("\n"));
    } catch (error) {
      notify?.(String(error));
    } finally {
      anchors.current.delete(id);
    }
  }
  const attachmentCallbacks = useRef({ attach, attachmentTarget });
  attachmentCallbacks.current = { attach, attachmentTarget };
  useEffect(() => {
    const language = new Compartment();
    const descriptor = LanguageDescription.matchFilename(
      languages,
      cacheKey.split("/").pop() || cacheKey,
    );
    const extensions = [
      language.of(/\.(md|markdown)$/i.test(cacheKey) ? markdown() : []),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      searchHighlights,
      EditorView.domEventHandlers({
        drop(event, editor) {
          if (event.dataTransfer?.types.includes("application/x-grove-tab")) {
            event.preventDefault();
            return true;
          }
          const { attachmentTarget, attach } = attachmentCallbacks.current;
          if (!attachmentTarget || !event.dataTransfer?.files.length) return false;
          event.preventDefault();
          editor.focus();
          const anchor =
            editor.posAtCoords({ x: event.clientX, y: event.clientY }) ?? editor.state.doc.length;
          void attach(
            () =>
              window.folio.importDropped(
                attachmentTarget.path,
                event.timeStamp,
                attachmentTarget.root,
              ),
            anchor,
          );
          return true;
        },
        paste(event) {
          const { attachmentTarget, attach } = attachmentCallbacks.current;
          if (
            !attachmentTarget ||
            ![...(event.clipboardData?.items || [])].some((item) => item.type.startsWith("image/"))
          )
            return false;
          event.preventDefault();
          void attach(() =>
            window.folio.pasteScreenshot(
              attachmentTarget.path,
              event.timeStamp,
              attachmentTarget.root,
            ),
          );
          return true;
        },
      }),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.keyword, color: "var(--syntax-keyword)" },
          { tag: tags.string, color: "var(--syntax-code)" },
          { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
          { tag: tags.number, color: "var(--syntax-number)" },
          { tag: tags.function(tags.variableName), color: "var(--syntax-function)" },
          { tag: tags.typeName, color: "var(--syntax-heading)" },
          { tag: tags.heading, color: "var(--syntax-heading)", fontWeight: "600" },
          { tag: tags.monospace, color: "var(--syntax-code)" },
          { tag: tags.link, color: "var(--syntax-heading)" },
          { tag: tags.url, color: "var(--muted)" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strong, fontWeight: "700" },
          { tag: tags.list, color: "var(--syntax-list)" },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        for (const transaction of update.transactions)
          for (const [id, position] of anchors.current)
            anchors.current.set(id, transaction.changes.mapPos(position, 1));
        if (update.docChanged && !update.transactions.every((t) => t.annotation(fromApp)))
          callbacks.current.onChange(update.state.doc.toString());
        if (update.selectionSet)
          setLine(update.state.doc.lineAt(update.state.selection.main.head).number);
        if (update.selectionSet) {
          const { anchor, head } = update.state.selection.main;
          callbacks.current.onPosition?.({ selection: { anchor, head } });
        }
      }),
      EditorView.theme({
        "&": { height: "100%", fontSize: `${fontSize}px` },
        ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.75" },
        ".cm-content": { padding: "32px 28px 120px", maxWidth: "940px" },
        ".cm-gutters": {
          backgroundColor: "transparent",
          border: "none",
          color: "var(--faint)",
          minWidth: "56px",
          paddingTop: "32px",
        },
        ".cm-activeLine,.cm-activeLineGutter": { backgroundColor: "var(--hover)" },
        ".cm-cursor": { borderLeftColor: "var(--text)" },
        ".cm-selectionBackground": { backgroundColor: "var(--sel) !important" },
        "&.cm-focused": { outline: "none" },
      }),
    ];
    const previous = cached.get(cacheKey);
    const state = previous
      ? previous.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({
          doc: value,
          extensions,
          selection: position?.selection
            ? {
                anchor: Math.min(value.length, position.selection.anchor),
                head: Math.min(value.length, position.selection.head),
              }
            : undefined,
        });
    const editor = new EditorView({ parent: host.current!, state });

    if (previous) {
      editor.scrollDOM.scrollTop = previous.scroll;
    }
    view.current = editor;
    const scroll = () =>
      callbacks.current.onPosition?.({ editorScroll: editor.scrollDOM.scrollTop });
    editor.scrollDOM.addEventListener("scroll", scroll);
    const frame = requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = previous?.scroll ?? position?.editorScroll ?? 0;
    });
    let live = true;
    if (descriptor)
      void descriptor
        .load()
        .then((support) => {
          if (live) editor.dispatch({ effects: language.reconfigure(support) });
        })
        .catch(() => {});
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      editor.scrollDOM.removeEventListener("scroll", scroll);
      cached.set(cacheKey, { state: editor.state, scroll: editor.scrollDOM.scrollTop });
      if (view.current === editor) view.current = null;
      anchors.current.clear();
      editor.destroy();
    };
  }, [fontSize, cacheKey]);
  useEffect(() => {
    if (!pendingDrop || !attachmentTarget) return;
    view.current?.focus();
    void attach(
      () =>
        window.folio.importDropped(attachmentTarget.path, pendingDrop.stamp, attachmentTarget.root),
      pendingDrop.anchor,
    );
    onDropHandled?.();
  }, [pendingDrop?.stamp]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) {
      const previous = editor.state.doc.toString();
      let from = 0,
        end = 0;
      while (from < previous.length && from < value.length && previous[from] === value[from])
        from++;
      while (
        end < previous.length - from &&
        end < value.length - from &&
        previous[previous.length - 1 - end] === value[value.length - 1 - end]
      )
        end++;
      editor.dispatch({
        changes: { from, to: previous.length - end, insert: value.slice(from, value.length - end) },
        annotations: fromApp.of(true),
      });
    }
  }, [value]);
  useEffect(() => {
    const editor = view.current,
      find = position?.find;
    if (!editor || !find) return;
    editor.dispatch({
      effects: [
        searchQuery.of(find.query),
        EditorView.scrollIntoView(Math.min(find.from, editor.state.doc.length), { y: "center" }),
      ],
      selection: {
        anchor: Math.min(find.from, editor.state.doc.length),
        head: Math.min(find.to, editor.state.doc.length),
      },
    });
  }, [position?.find?.id]);
  return (
    <div className="editor-wrap">
      <div className="editor" ref={host} />
      <footer className="editor-footer">
        {attachmentTarget && (
          <button
            onClick={() =>
              void attach(() =>
                window.folio.chooseAttachments(attachmentTarget.path, attachmentTarget.root),
              )
            }
          >
            + Attach file
          </button>
        )}
        <button
          onClick={() => {
            const e = view.current!;
            const s = e.state.selection.main;
            callbacks.current.onAsk(
              e.state.sliceDoc(s.from, s.to) || e.state.doc.lineAt(s.head).text,
            );
          }}
        >
          + Ask about Ln {line}
        </button>
        <span>Ln {line}</span>
        <span className="push">
          Markdown · UTF-8 · {value.trim().split(/\s+/).filter(Boolean).length} words
        </span>
      </footer>
    </div>
  );
}
import { useState } from "react";
function useLine() {
  return useState(1);
}
