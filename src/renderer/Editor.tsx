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
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
  history,
  historyKeymap,
  defaultKeymap,
  isolateHistory,
  undo,
  redo,
  undoDepth,
  redoDepth,
  indentMore,
  indentLess,
} from "@codemirror/commands";
import { attachmentMarkdown } from "../shared/attachments";
import type { AttachmentResult } from "../shared/types";
import { textMatches } from "../shared/search";
import { formatMarkdown, type MarkdownAction } from "../shared/markdown-format";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { VaultInsertDialog } from "./VaultInsertDialog";
import { takeEditor, rememberEditor } from "./editor-cache";
import { livePreview as liveExtension, refreshLivePreview } from "./live-preview";
import type { LiveOptions } from "./live-preview";
import { ReferenceDialog } from "./ReferenceDialog";
import { referenceAt, referenceMarkdown } from "./markdown-reference";
import type { Reference } from "./markdown-reference";
export { forgetEditor } from "./editor-cache";
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
import {
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription,
  syntaxTree,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { ViewState } from "../shared/types";
const fromApp = Annotation.define<boolean>();
function inMarkdownList(editor: EditorView) {
  return editor.state.selection.ranges.every((range) => {
    for (
      let node = syntaxTree(editor.state).resolveInner(
        range.head,
        range.head === editor.state.doc.lineAt(range.head).from ? 1 : -1,
      );
      node.parent;
      node = node.parent
    ) {
      if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(node.name)) return false;
      if (node.name === "ListItem") return true;
    }
    return false;
  });
}
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
  isMarkdown = false,
  vaultRoot,
  livePreview,
  toolbarEnd,
}: {
  cacheKey: string;
  value: string;
  onChange: (text: string) => void;
  fontSize: number;
  onAsk?: (selection: string) => void;
  position?: ViewState;
  onPosition?: (position: Partial<ViewState>) => void;
  attachmentTarget?: { path: string; root: string };
  pendingDrop?: { stamp: number; anchor: number };
  onDropHandled?: () => void;
  notify?: (message: string) => void;
  isMarkdown?: boolean;
  vaultRoot?: string;
  livePreview?: LiveOptions;
  toolbarEnd?: React.ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onAsk, onPosition });
  callbacks.current = { onChange, onAsk, onPosition };
  const [line, setLine] = useLine();
  const anchors = useRef(new Map<string, number>());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [insertion, setInsertion] = useState<{ editor: EditorView; start: string; end: string }>();
  const [referenceEdit, setReferenceEdit] = useState<{
    editor: EditorView;
    source: string;
    reference: Reference;
  }>();
  const format = (action: MarkdownAction) => {
    const editor = view.current;
    if (!editor || !isMarkdown) return;
    if (livePreview?.format?.(action)) return;
    let { from, to } = editor.state.selection.main;
    if (action === "table" && livePreview) {
      const widget = document.activeElement?.closest(".tiptap")?.closest(".cm-live-widget");
      if (widget && editor.contentDOM.contains(widget)) {
        for (
          let node = syntaxTree(editor.state).resolveInner(editor.posAtDOM(widget), 1);
          node.parent;
          node = node.parent
        )
          if (node.name === "Table") {
            from = to = node.to;
            break;
          }
      }
    }
    if (action === "link") {
      const source = editor.state.doc.toString();
      const reference: Reference = referenceAt(source, from) ?? {
        kind: "link",
        address: "",
        label: source.slice(from, to) || "link",
        title: "",
        from,
        to,
        raw: "",
      };
      setReferenceEdit({ editor, source, reference });
      return;
    }
    const edit = formatMarkdown(editor.state.doc.toString(), from, to, action);
    if (action === "table" && livePreview)
      edit.selection = {
        anchor:
          from +
          edit.changes[0].insert.length +
          Math.min(2, editor.state.doc.sliceString(to).match(/^\n*/)![0].length),
        head:
          from +
          edit.changes[0].insert.length +
          Math.min(2, editor.state.doc.sliceString(to).match(/^\n*/)![0].length),
      };
    editor.dispatch({
      ...edit,
      annotations: isolateHistory.of("full"),
      userEvent: "input.format",
    });
    editor.focus();
  };
  const formatting = useRef(format);
  formatting.current = format;
  const closeInsert = () => {
    if (insertion) {
      anchors.current.delete(insertion.start);
      anchors.current.delete(insertion.end);
    }
    setInsertion(undefined);
  };
  // Focus after the modal dialog unmounts; while it is open the editor is inert.
  const wasInserting = useRef(false);
  useEffect(() => {
    if (insertion || referenceEdit) wasInserting.current = true;
    else if (wasInserting.current) {
      wasInserting.current = false;
      view.current?.focus();
    }
  }, [insertion, referenceEdit]);
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
      language.of(isMarkdown ? markdown({ base: markdownLanguage }) : []),
      ...(livePreview ? [liveExtension(livePreview)] : [lineNumbers()]),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      drawSelection(),
      history(),
      keymap.of([
        ...(isMarkdown
          ? [
              {
                key: "Tab",
                run: (editor: EditorView) => inMarkdownList(editor) && indentMore(editor),
                shift: (editor: EditorView) => inMarkdownList(editor) && indentLess(editor),
              },
              {
                key: "Mod-b",
                run: () => {
                  formatting.current("bold");
                  return true;
                },
              },
              {
                key: "Mod-i",
                run: () => {
                  formatting.current("italic");
                  return true;
                },
              },
            ]
          : []),
        ...defaultKeymap,
        ...historyKeymap,
      ]),
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
          {
            tag: tags.heading,
            color: livePreview ? "var(--text)" : "var(--syntax-heading)",
            fontWeight: "600",
          },
          { tag: tags.monospace, color: livePreview ? "var(--text)" : "var(--syntax-code)" },
          { tag: tags.link, color: livePreview ? "var(--accent)" : "var(--syntax-heading)" },
          { tag: tags.url, color: "var(--muted)" },
          { tag: tags.emphasis, fontStyle: "italic" },
          { tag: tags.strong, fontWeight: "700" },
          { tag: tags.list, color: livePreview ? "var(--text)" : "var(--syntax-list)" },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        setCanUndo(undoDepth(update.state) > 0);
        setCanRedo(redoDepth(update.state) > 0);
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
        ".cm-content": { padding: "32px 28px 120px" },
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
    const previous = takeEditor(cacheKey);
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
    if (livePreview) {
      editor.contentDOM.classList.add("md", "live-markdown");
      editor.contentDOM.setAttribute("aria-label", "Editable live preview");
      editor.scrollDOM.classList.add("preview");
    }

    if (previous) {
      editor.scrollDOM.scrollTop = previous.scroll;
    }
    view.current = editor;
    setCanUndo(undoDepth(state) > 0);
    setCanRedo(redoDepth(state) > 0);
    const scroll = () =>
      callbacks.current.onPosition?.({ editorScroll: editor.scrollDOM.scrollTop });
    editor.scrollDOM.addEventListener("scroll", scroll);
    const frame = requestAnimationFrame(() => {
      editor.scrollDOM.scrollTop = previous?.scroll ?? position?.editorScroll ?? 0;
    });
    let live = true;
    if (descriptor && !isMarkdown)
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
      rememberEditor(cacheKey, { state: editor.state, scroll: editor.scrollDOM.scrollTop });
      if (view.current === editor) view.current = null;
      anchors.current.clear();
      editor.destroy();
    };
  }, [fontSize, cacheKey, isMarkdown, !!livePreview]);
  useEffect(() => {
    if (livePreview && view.current)
      view.current.dispatch({ effects: refreshLivePreview.of(null) });
  }, [livePreview?.dark]);
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
    <div className={`editor-wrap ${livePreview ? "live-preview" : ""}`}>
      {referenceEdit && (
        <ReferenceDialog
          reference={referenceEdit.reference}
          close={() => setReferenceEdit(undefined)}
          save={(reference) => {
            if (
              value !== referenceEdit.source ||
              view.current !== referenceEdit.editor ||
              view.current.state.doc.toString() !== referenceEdit.source
            )
              return "The note changed. Close this dialog and open the item again.";
            const insert = referenceMarkdown(reference);
            view.current.dispatch({
              changes: { from: reference.from, to: reference.to, insert },
              selection: { anchor: reference.from + insert.length },
              annotations: isolateHistory.of("full"),
              userEvent: "input.reference",
            });
          }}
          remove={
            referenceEdit.reference.raw
              ? () => {
                  if (
                    value !== referenceEdit.source ||
                    view.current !== referenceEdit.editor ||
                    view.current.state.doc.toString() !== referenceEdit.source
                  )
                    return "The note changed. Close this dialog and open the item again.";
                  const ref = referenceEdit.reference;
                  const insert =
                    ref.kind === "link" || ref.kind === "wiki"
                      ? (ref.labelSource ?? (ref.label || ref.address))
                      : "";
                  view.current.dispatch({
                    changes: { from: ref.from, to: ref.to, insert },
                    annotations: isolateHistory.of("full"),
                    userEvent: "input.reference",
                  });
                }
              : undefined
          }
        />
      )}
      {isMarkdown && (
        <MarkdownToolbar
          format={format}
          canUndo={livePreview?.canUndo?.() ?? canUndo}
          canRedo={livePreview?.canRedo?.() ?? canRedo}
          undo={() => {
            if (livePreview?.undo?.()) return;
            if (view.current) {
              undo(view.current);
              view.current.focus();
            }
          }}
          redo={() => {
            if (livePreview?.redo?.()) return;
            if (view.current) {
              redo(view.current);
              view.current.focus();
            }
          }}
          insert={
            vaultRoot
              ? () => {
                  const editor = view.current;
                  if (!editor) return;
                  const start = crypto.randomUUID(),
                    end = crypto.randomUUID();
                  anchors.current.set(start, editor.state.selection.main.from);
                  anchors.current.set(end, editor.state.selection.main.to);
                  setInsertion({ editor, start, end });
                }
              : undefined
          }
        >
          {toolbarEnd}
        </MarkdownToolbar>
      )}
      <div className="editor" ref={host} />
      {insertion && vaultRoot && (
        <VaultInsertDialog
          root={vaultRoot}
          close={closeInsert}
          insert={(content) => {
            const editor = view.current,
              from = anchors.current.get(insertion.start),
              to = anchors.current.get(insertion.end);
            if (editor !== insertion.editor || from === undefined || to === undefined) {
              notify?.("The editor changed. Reopen Insert from vault.");
              closeInsert();
              return;
            }
            const before = from > 0 && editor.state.sliceDoc(from - 1, from) !== "\n" ? "\n" : "";
            const after =
              to < editor.state.doc.length && editor.state.sliceDoc(to, to + 1) !== "\n"
                ? "\n"
                : "";
            const insert = before + content + after;
            editor.dispatch({
              changes: { from, to, insert },
              selection: { anchor: from + insert.length },
              annotations: isolateHistory.of("full"),
              userEvent: "input.insert",
            });
            closeInsert();
          }}
        />
      )}
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
        {onAsk && (
          <button
            data-desktop
            onClick={() => {
              const e = view.current!;
              const s = e.state.selection.main;
              callbacks.current.onAsk?.(
                e.state.sliceDoc(s.from, s.to) || e.state.doc.lineAt(s.head).text,
              );
            }}
          >
            + Ask about Ln {line}
          </button>
        )}
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
