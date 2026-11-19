import { Disclosure } from "./Controls";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import type { EditorProps } from "@tiptap/pm/view";
import { getMarkRange } from "@tiptap/core";
import type { Editor as RichEditor } from "@tiptap/core";
import { createTable } from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, Selection } from "@tiptap/pm/state";
import type { Document } from "../shared/types";
import type { MarkdownAction } from "../shared/markdown-format";
import {
  GroveCode,
  GroveImage,
  GroveRaw,
  GroveWiki,
  RichMarkdownModel,
  richExtensions,
} from "./rich-markdown";
import { CodeBlock } from "./CodeBlock";
import { Diagram, Markdown } from "./Markdown";
import { Editor, forgetEditor } from "./Editor";
import { MarkdownToolbar } from "./MarkdownToolbar";
import { VaultInsertDialog } from "./VaultInsertDialog";
import { CopyButton } from "./CopyButton";
import { resolveLink } from "../shared/links";
import { useAsset } from "./useAsset";
import { ReferenceDialog } from "./ReferenceDialog";
import type { Reference } from "./markdown-reference";
import { referenceAt, referenceMarkdown } from "./markdown-reference";
import { TableTools } from "./TableTools";
import { ItemMenu, ItemMenuItem, useItemMenu } from "./ItemMenu";

type Props = {
  doc: Document;
  value: string;
  onChange: (value: string) => void;
  open: (path: string) => void;
  dark: boolean;
  vaultRoot?: string;
  embedded?: boolean;
  initialScroll?: number;
  toolbarEnd?: React.ReactNode;
  onFocus?: (controls: RichControls) => void;
};
export type RichControls = {
  editor: RichEditor;
  format: (action: MarkdownAction) => void;
};
const Context = createContext<
  (Pick<Props, "doc" | "open" | "dark" | "vaultRoot"> & { revision: number }) | null
>(null);
function CodeView({
  node: renderedNode,
  updateAttributes,
  editor,
  getPos,
  deleteNode,
}: NodeViewProps) {
  const position = getPos();
  const current = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
  // Revision context can arrive before portal props; use the canonical node attributes.
  const node = current?.type === renderedNode.type ? current : renderedNode;
  const context = useContext(Context)!;
  const menu = useItemMenu(() => editor.state.doc);
  useEffect(() => menu.close(), [context.revision, menu.close]);
  const [editing, setEditing] = useState(false);
  const identity = useRef(crypto.randomUUID());
  const key = `rich-code-${identity.current}-${context.revision}.${node.attrs.language || "txt"}`;
  useEffect(
    () => () => {
      queueMicrotask(() => forgetEditor(key));
    },
    [key],
  );
  const body = String(node.attrs.body),
    language = String(node.attrs.language);
  const change = (body: string) => {
    if (editor.isEditable) updateAttributes({ body });
  };
  const source = (
    <div className="rich-source-panel">
      <label>
        Language
        <input
          aria-label="Code language"
          key={language}
          defaultValue={language}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (editor.isEditable && next !== language && !/[\s`~]/.test(next))
              updateAttributes({ language: next, original: "" });
          }}
        />
      </label>
      <div className="rich-code-source">
        <Editor
          key={context.revision}
          cacheKey={key}
          value={body}
          onChange={change}
          fontSize={14}
          isMarkdown={/^(md|markdown)$/i.test(language)}
          vaultRoot={context.vaultRoot}
          attachmentTarget={
            context.vaultRoot ? { path: context.doc.path, root: context.vaultRoot } : undefined
          }
        />
      </div>
    </div>
  );
  if (language === "mermaid")
    return (
      <NodeViewWrapper
        className="rich-code"
        contentEditable={false}
        onContextMenu={(event: React.MouseEvent) => {
          if (editor.isEditable) menu.open(event);
        }}
      >
        <Diagram source={body} dark={context.dark} />
        <button onClick={() => setEditing(!editing)}>
          {editing ? "Done" : "Edit diagram source"}
        </button>
        {editing && source}
        {menu.point && (
          <ItemMenu point={menu.point} close={menu.close}>
            <ItemMenuItem onClick={() => setEditing(true)}>Edit diagram source</ItemMenuItem>
            <ItemMenuItem
              onClick={() => {
                if (editor.isEditable && menu.isCurrent()) deleteNode();
              }}
            >
              Remove diagram
            </ItemMenuItem>
          </ItemMenu>
        )}
      </NodeViewWrapper>
    );
  return (
    <NodeViewWrapper
      className="rich-code"
      contentEditable={false}
      onContextMenu={(event: React.MouseEvent) => {
        if (editor.isEditable) menu.open(event);
      }}
    >
      <CodeBlock
        text={body}
        language={language}
        dark={context.dark}
        edit={() => setEditing(!editing)}
        editLabel={editing ? "Done" : "Edit"}
        onPreview={() => setEditing(false)}
        sourceEditor={editing ? source : undefined}
        preview={
          /^(md|markdown)$/i.test(language) ? (
            <RichPreview
              key={context.revision}
              {...context}
              value={body}
              onChange={change}
              embedded
            />
          ) : undefined
        }
      />
      {menu.point && (
        <ItemMenu point={menu.point} close={menu.close}>
          <ItemMenuItem onClick={() => setEditing(true)}>Edit code source</ItemMenuItem>
          <ItemMenuItem
            onClick={() => {
              if (editor.isEditable && menu.isCurrent()) deleteNode();
            }}
          >
            Remove code block
          </ItemMenuItem>
        </ItemMenu>
      )}
    </NodeViewWrapper>
  );
}
function RawView({
  node: renderedNode,
  updateAttributes,
  editor,
  getPos,
  deleteNode,
}: NodeViewProps) {
  const context = useContext(Context)!;
  const menu = useItemMenu(() => editor.state.doc);
  useEffect(() => menu.close(), [context.revision, menu.close]);
  const position = getPos(),
    current = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
  const node = current?.type === renderedNode.type ? current : renderedNode;
  const [editing, setEditing] = useState(false),
    [reference, setReference] = useState<{
      value: Reference;
      document: ProseMirrorNode;
    } | null>(null);
  const identity = useRef(crypto.randomUUID());
  const key = `rich-raw-${identity.current}-${context.revision}.md`;
  useEffect(
    () => () => {
      queueMicrotask(() => forgetEditor(key));
    },
    [key],
  );
  const raw = String(node.attrs.raw),
    kind = String(node.attrs.kind);
  const item = /^[\t ]*!?\[/.test(raw) ? referenceAt(raw, 0) : null;
  const labels: Record<string, string> = {
    properties: "Properties",
    html: raw.trim().startsWith("<!--") ? "Comment" : "HTML",
    definition: "Link reference",
  };
  return (
    <NodeViewWrapper
      className="rich-preserved-block"
      contentEditable={false}
      onContextMenu={(event: React.MouseEvent) => {
        if (editor.isEditable) menu.open(event);
      }}
    >
      {menu.point && (
        <ItemMenu point={menu.point} close={menu.close}>
          {item && (
            <ItemMenuItem onClick={() => setReference({ value: item, document: editor.state.doc })}>
              Edit {item.kind === "link" || item.kind === "wiki" ? "link" : "media"}
            </ItemMenuItem>
          )}
          <ItemMenuItem onClick={() => setEditing(!editing)}>
            {editing ? "Done" : "Edit source"}
          </ItemMenuItem>
          <ItemMenuItem
            onClick={() => {
              if (editor.isEditable && menu.isCurrent()) deleteNode();
            }}
          >
            Remove block
          </ItemMenuItem>
        </ItemMenu>
      )}
      {editing ? (
        <div>
          <button onClick={() => setEditing(false)}>Done</button>
          <div className="rich-code-source">
            <Editor
              key={context.revision}
              cacheKey={key}
              value={raw}
              onChange={(raw) => {
                if (editor.isEditable) updateAttributes({ raw });
              }}
              fontSize={14}
              isMarkdown
              vaultRoot={context.vaultRoot}
            />
          </div>
        </div>
      ) : (
        <>
          {labels[kind] ? (
            <Disclosure title={labels[kind]}>
              <pre>{raw}</pre>
            </Disclosure>
          ) : (
            <Markdown
              {...context}
              value={raw}
              onChange={(raw) => {
                if (editor.isEditable) updateAttributes({ raw });
              }}
              embedded
            />
          )}
        </>
      )}
      {reference && (
        <ReferenceDialog
          reference={reference.value}
          close={() => setReference(null)}
          save={(value) => {
            if (!editor.isEditable || editor.state.doc !== reference.document)
              return "The note changed. Open this item again.";
            updateAttributes({
              raw: raw.slice(0, value.from) + referenceMarkdown(value) + raw.slice(value.to),
            });
          }}
          remove={() => {
            if (!editor.isEditable || editor.state.doc !== reference.document)
              return "The note changed. Open this item again.";
            deleteNode();
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
function ReferenceView({
  node: renderedNode,
  editor,
  getPos,
  updateAttributes,
  deleteNode,
}: NodeViewProps) {
  const context = useContext(Context)!;
  const menu = useItemMenu(() => editor.state.doc);
  useEffect(() => menu.close(), [context.revision, menu.close]);
  const position = getPos(),
    current = typeof position === "number" ? editor.state.doc.nodeAt(position) : null;
  const node = current?.type === renderedNode.type ? current : renderedNode;
  const [editing, setEditing] = useState<{
    reference: Reference;
    document: ProseMirrorNode;
  } | null>(null);
  const wiki = node.type.name === "groveWiki";
  const reference: Reference = (wiki
    ? referenceAt(String(node.attrs.raw), 0)
    : referenceAt(
        String(node.attrs.raw) ||
          referenceMarkdown({
            kind: "image",
            address: String(node.attrs.src),
            label: String(node.attrs.alt ?? ""),
            title: String(node.attrs.title ?? ""),
            from: 0,
            to: 0,
            raw: "",
          }),
        0,
      )) ?? {
    kind: wiki ? "wiki" : "image",
    address: String(node.attrs.src ?? ""),
    label: String(node.attrs.alt ?? ""),
    title: "",
    from: 0,
    to: 0,
    raw: String(node.attrs.raw ?? ""),
  };
  const src = reference.address,
    alt = reference.label || reference.address || "Image";
  const local = !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src);
  const path = local ? (resolveLink(context.doc.path, src, [])?.path ?? "") : "";
  const { url } = useAsset(path, !!path && !wiki);
  return (
    <NodeViewWrapper
      as="span"
      className={wiki ? "rich-wiki" : "rich-inline-image"}
      contentEditable={false}
      onContextMenu={(event: React.MouseEvent) => {
        if (editor.isEditable) menu.open(event);
      }}
    >
      <button
        className="reference-item"
        aria-label={wiki ? "Edit wiki link" : "Edit image"}
        onClick={(event) => {
          if (!editor.isEditable) return;
          if (event.ctrlKey || event.metaKey) {
            if (path) context.open(path);
            return;
          }
          setEditing({ reference, document: editor.state.doc });
        }}
      >
        {url ? (
          <img src={url} alt={alt} title={node.attrs.title || undefined} />
        ) : (
          <span>{alt}</span>
        )}
      </button>
      {menu.point && (
        <ItemMenu point={menu.point} close={menu.close}>
          <ItemMenuItem onClick={() => setEditing({ reference, document: editor.state.doc })}>
            {wiki ? "Edit wiki link" : "Edit image"}
          </ItemMenuItem>
          <ItemMenuItem
            onClick={() => {
              if (editor.isEditable && menu.isCurrent()) deleteNode();
            }}
          >
            {wiki ? "Remove reference" : "Remove image"}
          </ItemMenuItem>
        </ItemMenu>
      )}
      {editing && (
        <ReferenceDialog
          reference={editing.reference}
          close={() => setEditing(null)}
          save={(value) => {
            if (!editor.isEditable || editor.state.doc !== editing.document)
              return "The note changed. Open this item again.";
            if (wiki) updateAttributes({ raw: referenceMarkdown(value) });
            else
              updateAttributes({
                src: value.address,
                alt: value.label,
                title: value.title || null,
                raw: referenceMarkdown(value),
              });
          }}
          remove={() => {
            if (!editor.isEditable || editor.state.doc !== editing.document)
              return "The note changed. Open this item again.";
            deleteNode();
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
const extensions = richExtensions.map((extension) => {
  if (extension.name === GroveCode.name)
    return GroveCode.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(CodeView, {
          stopEvent: () => true,
          ignoreMutation: () => true,
        }),
    });
  if (extension.name === GroveRaw.name)
    return GroveRaw.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(RawView, {
          stopEvent: () => true,
          ignoreMutation: () => true,
        }),
    });
  if (extension.name === GroveImage.name)
    return GroveImage.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(ReferenceView, {
          stopEvent: () => true,
          ignoreMutation: () => true,
        }),
    });
  if (extension.name === GroveWiki.name)
    return GroveWiki.extend({
      addNodeView: () =>
        ReactNodeViewRenderer(ReferenceView, {
          stopEvent: () => true,
          ignoreMutation: () => true,
        }),
    });
  return extension;
});

export function RichPreview(props: Props) {
  const last = useRef(props.value);
  const [session, setSession] = useState({ source: props.value, revision: 0 });
  // Local source echoes keep selection and history; external changes start a new source model.
  if (props.value !== last.current) {
    last.current = props.value;
    setSession({ source: props.value, revision: session.revision + 1 });
  }
  return (
    <RichSurface
      {...props}
      source={session.source}
      revision={session.revision}
      onChange={(value) => {
        last.current = value;
        props.onChange(value);
      }}
    />
  );
}
function RichSurface({
  source,
  doc,
  onChange,
  open,
  dark,
  vaultRoot,
  embedded = false,
  initialScroll = 0,
  revision,
  toolbarEnd,
  onFocus,
}: Omit<Props, "value"> & { source: string; revision: number }) {
  const [initialModel] = useState(() => new RichMarkdownModel(source));
  const model = useRef(initialModel);
  const externalRevision = useRef(revision);
  const [appliedRevision, setAppliedRevision] = useState(revision);
  const pending = revision !== appliedRevision;
  const callbacks = useRef({ onChange, open, doc });
  callbacks.current = { onChange, open, doc };
  // Source echoes must not render node views ahead of their new ProseMirror attributes.
  const context = useMemo(
    () => ({
      get doc() {
        return callbacks.current.doc;
      },
      get revision() {
        return externalRevision.current;
      },
      open: (path: string) => callbacks.current.open(path),
      dark,
      vaultRoot,
    }),
    [dark, vaultRoot, appliedRevision],
  );
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = root.current!;
    const restore = () => {
      if (!element.querySelector(".tiptap")) return;
      if (element.scrollHeight - element.clientHeight < initialScroll) return;
      element.scrollTop = initialScroll;
      observer.disconnect();
    };
    // Node views mount asynchronously; wait for scrollable content, or let user input take over.
    const observer = new ResizeObserver(restore);
    const cancel = () => observer.disconnect();
    for (const event of ["pointerdown", "keydown", "wheel"])
      element.addEventListener(event, cancel, true);
    observer.observe(element.querySelector(".rich-editor-content")!);
    restore();
    return () => {
      observer.disconnect();
      for (const event of ["pointerdown", "keydown", "wheel"])
        element.removeEventListener(event, cancel, true);
    };
  }, []);
  const [error, setError] = useState(""),
    [inserting, setInserting] = useState(false),
    [link, setLink] = useState<{
      reference: Reference;
      document: ProseMirrorNode;
      originalLabel: string;
    } | null>(null);
  const editorProps = useMemo<EditorProps>(
    () => ({
      attributes: {
        class: "md rich-md",
        role: "textbox",
        tabindex: "0",
        "aria-label": embedded ? "Editable embedded preview" : "Editable note preview",
        "aria-multiline": "true",
      },
      handleClick: (_view, _position, event) => {
        if (!(event.target instanceof Element)) return false;
        if (!(event.ctrlKey || event.metaKey)) return false;
        const wiki = event.target.closest<HTMLElement>("[data-grove-wiki]");
        const anchor = event.target.closest("a");
        const target =
          wiki?.dataset.groveWiki
            ?.replace(/^!?\[\[/, "")
            .replace(/\]\]$/, "")
            .split("|")[0] ?? anchor?.getAttribute("href");
        if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return false;
        const path = resolveLink(
          callbacks.current.doc.path,
          wiki && !/\.[a-z]+(?:#.*)?$/i.test(target) ? `${target}.md` : target,
          [],
        )?.path;
        if (path) {
          event.preventDefault();
          callbacks.current.open(path);
          return true;
        }
        return false;
      },
    }),
    [embedded],
  );
  const editor = useEditor({
    extensions,
    content: initialModel.document,
    immediatelyRender: true,
    editorProps,
    onFocus: ({ editor }) => onFocus?.({ editor, format }),
    onUpdate: ({ editor }) => {
      if (pending) return;
      try {
        callbacks.current.onChange(model.current.serialize(editor.getJSON()));
        setError("");
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save formatted edits. Copy your text before leaving Preview.",
        );
      }
    },
    onCreate: ({ editor }) => {
      let first = -1;
      editor.state.doc.descendants((node, position) => {
        if (first < 0 && node.isTextblock) first = position + 1;
        return first < 0;
      });
      if (first >= 0) editor.commands.setTextSelection(first);
    },
  });
  useLayoutEffect(() => {
    editor?.setEditable(!pending, false);
  }, [editor, pending]);
  useLayoutEffect(() => {
    if (!editor || !pending) return;
    const timer = setTimeout(() => {
      try {
        const next = new RichMarkdownModel(source);
        const doc = editor.schema.nodeFromJSON(next.document);
        const previous = editor.state;
        let selection: Selection;
        try {
          selection = Selection.fromJSON(doc, previous.selection.toJSON());
        } catch {
          selection = Selection.near(
            doc.resolve(Math.min(previous.selection.from, doc.content.size)),
          );
        }
        const scroll = root.current?.scrollTop ?? 0;
        // A fresh external source starts fresh undo history, but keeps the editor and node views.
        const state = EditorState.create({
          schema: editor.schema,
          doc,
          selection,
          plugins: previous.plugins,
        });
        model.current = next;
        externalRevision.current = revision;
        editor.view.updateState(state);
        editor.emit("transaction", {
          editor,
          transaction: state.tr,
          appendedTransactions: [],
        });
        if (root.current) root.current.scrollTop = scroll;
        setAppliedRevision(revision);
        setError("");
      } catch (reason) {
        setError(`Preview could not update. Your source edits are kept in Edit. ${String(reason)}`);
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [editor, source, revision, appliedRevision, pending]);
  const history = useEditorState({
    editor,
    selector: ({ editor }) => {
      const headings: { position: number; level: number; title: string }[] = [];
      editor.state.doc.forEach((node, position) => {
        if (node.type.name === "heading" && node.attrs.level <= 3)
          headings.push({
            position,
            level: node.attrs.level,
            title: node.textContent,
          });
      });
      return {
        undo: editor.can().undo(),
        redo: editor.can().redo(),
        headings,
        selection: editor.state.selection.from,
        table: editor.isActive("table"),
        link: editor.isActive("link"),
        list: editor.isActive("taskItem")
          ? "taskItem"
          : editor.isActive("listItem")
            ? "listItem"
            : null,
        quote: editor.isActive("blockquote"),
      };
    },
  });
  const editLink = () => {
    const range =
      getMarkRange(editor.state.selection.$from, editor.schema.marks.link) ??
      editor.state.selection;
    const label = editor.state.doc.textBetween(range.from, range.to, "\n"),
      attrs = editor.getAttributes("link");
    setLink({
      reference: {
        kind: "link",
        address: String(attrs.href ?? ""),
        label: label || "link",
        title: String(attrs.title ?? ""),
        from: range.from,
        to: range.to,
        raw: "",
      },
      document: editor.state.doc,
      originalLabel: label,
    });
  };
  const format = (action: MarkdownAction) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (action === "bold") chain.toggleBold().run();
    else if (action === "italic") chain.toggleItalic().run();
    else if (action === "quote") chain.toggleBlockquote().run();
    else if (action === "bullet") chain.toggleBulletList().run();
    else if (action === "ordered") chain.toggleOrderedList().run();
    else if (action === "task") chain.toggleTaskList().run();
    else if (action === "h0") chain.setParagraph().run();
    else if (/^h[1-6]$/.test(action))
      chain.toggleHeading({ level: Number(action[1]) as 1 | 2 | 3 | 4 | 5 | 6 }).run();
    else if (action === "link") editLink();
    else if (action === "table") {
      const { $from } = editor.state.selection;
      let after: number | undefined;
      for (let depth = $from.depth; depth > 0; depth--)
        if ($from.node(depth).type.name === "table") {
          after = $from.after(depth);
          break;
        }
      if (after !== undefined)
        chain.insertContentAt(after, createTable(editor.schema, 3, 2, true).toJSON()).run();
      else chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    } else if (action === "code") {
      const text = editor.state.doc.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        "\n",
      );
      if (text.includes("\n"))
        chain
          .insertContent({
            type: "groveCode",
            attrs: { body: text, language: "", original: "" },
          })
          .run();
      else chain.toggleCode().run();
    }
  };
  if (!editor) return null;
  return (
    <Context.Provider value={context}>
      <div
        className={`rich-preview-shell ${embedded ? "embedded" : ""}`}
        inert={pending}
        aria-busy={pending}
      >
        <MarkdownToolbar
          format={format}
          undo={() => editor.chain().focus().undo().run()}
          redo={() => editor.chain().focus().redo().run()}
          canUndo={history?.undo ?? false}
          canRedo={history?.redo ?? false}
          insert={vaultRoot ? () => setInserting(true) : undefined}
        >
          {toolbarEnd}
        </MarkdownToolbar>
        {history && (
          <TableTools
            editor={editor}
            table={history.table}
            list={history.list}
            link={history.link}
            editLink={editLink}
          />
        )}
        {error && (
          <div className="banner warning" role="alert">
            <span>{error}</span>
            <CopyButton text={editor.getText()} />
          </div>
        )}
        <div className="preview rich-preview" ref={root}>
          {!embedded && history && history.headings.length >= 3 && (
            <nav className="document-outline" aria-label="Document outline">
              {history.headings.map((heading, index) => (
                <button
                  key={heading.position}
                  title={heading.title}
                  className={
                    history.selection > heading.position &&
                    (!history.headings[index + 1] ||
                      history.selection <= history.headings[index + 1].position)
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .setTextSelection(heading.position + 1)
                      .scrollIntoView()
                      .run()
                  }
                >
                  <i style={{ width: 20 - heading.level * 4 }} />
                  <span>{heading.title}</span>
                </button>
              ))}
            </nav>
          )}
          <EditorContent className="rich-editor-content" editor={editor} />
        </div>
        {inserting && vaultRoot && (
          <VaultInsertDialog
            root={vaultRoot}
            close={() => setInserting(false)}
            insert={(value) => {
              editor.chain().focus().insertContent(value, { contentType: "markdown" }).run();
              setInserting(false);
            }}
          />
        )}
        {link && (
          <ReferenceDialog
            reference={link.reference}
            close={() => setLink(null)}
            save={(reference) => {
              if (editor.isDestroyed || !editor.isEditable || editor.state.doc !== link.document)
                return "The note changed. Close this dialog and open the link again.";
              const chain = editor
                .chain()
                .focus()
                .setTextSelection({ from: reference.from, to: reference.to });
              if (reference.label !== link.originalLabel)
                chain
                  .insertContent({
                    type: "text",
                    text: reference.label || reference.address,
                    marks: [
                      {
                        type: "link",
                        attrs: {
                          href: reference.address,
                          title: reference.title || null,
                        },
                      },
                    ],
                  })
                  .run();
              else
                chain
                  .setLink({
                    href: reference.address,
                    title: reference.title || null,
                  })
                  .run();
            }}
            remove={
              link.reference.address
                ? () => {
                    if (
                      editor.isDestroyed ||
                      !editor.isEditable ||
                      editor.state.doc !== link.document
                    )
                      return "The note changed. Close this dialog and open the link again.";
                    editor
                      .chain()
                      .focus()
                      .setTextSelection({
                        from: link.reference.from,
                        to: link.reference.to,
                      })
                      .unsetLink()
                      .run();
                  }
                : undefined
            }
          />
        )}
      </div>
    </Context.Provider>
  );
}
