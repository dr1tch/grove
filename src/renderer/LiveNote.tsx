import { Disclosure } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Document, ViewState } from "../shared/types";
import type { LiveKind, LiveOptions } from "./live-preview";
import { Editor } from "./Editor";
import { Markdown, Diagram } from "./Markdown";
import { CodeBlock } from "./CodeBlock";
import { codeBlocks, replaceCodeBlock } from "@grove/core/code-block";
import { resolveLink } from "../shared/links";
import { RichPreview } from "./RichPreview";
import type { RichControls } from "./RichPreview";
import { ReferenceDialog } from "./ReferenceDialog";
import { referenceAt, referenceMarkdown } from "./markdown-reference";
import type { Reference } from "./markdown-reference";
import { ItemMenu, ItemMenuItem, useItemMenu } from "./ItemMenu";

type Props = {
  doc: Document;
  value: string;
  onChange: (value: string) => void;
  open: (path: string) => void;
  dark: boolean;
  vaultRoot: string;
  cacheKey: string;
  fontSize: number;
  scroll: number;
  onScroll: (value: number) => void;
  notify: (message: string) => void;
  toolbarEnd?: React.ReactNode;
};
const roots = new WeakMap<HTMLElement, Root>();
function Block({
  source,
  kind,
  props,
  reveal,
  change,
  activate,
}: {
  source: string;
  kind: LiveKind;
  props: Props;
  reveal: () => void;
  change: (value: string) => void;
  activate: (controls: RichControls) => void;
}) {
  const menu = useItemMenu(() => source);
  useEffect(() => menu.close(), [source, menu.close]);
  const [referenceEdit, setReferenceEdit] = useState<{
    reference: Reference;
    source: string;
  } | null>(null);
  const isDiagram = kind === "code" && codeBlocks(source)[0]?.language === "mermaid";
  const menuUI = menu.point && (
    <ItemMenu point={menu.point} close={menu.close}>
      {kind === "media" && (
        <ItemMenuItem
          onClick={() => {
            const reference = referenceAt(source, 0);
            if (reference) setReferenceEdit({ reference, source });
          }}
        >
          Edit media
        </ItemMenuItem>
      )}
      <ItemMenuItem onClick={reveal}>
        {isDiagram ? "Edit diagram source" : kind === "code" ? "Edit code source" : "Edit source"}
      </ItemMenuItem>
      <ItemMenuItem onClick={() => change("")}>
        {isDiagram
          ? "Remove diagram"
          : kind === "code"
            ? "Remove code block"
            : kind === "media"
              ? "Remove embed"
              : "Remove block"}
      </ItemMenuItem>
    </ItemMenu>
  );
  if (kind === "code") {
    // shortcut: quoted fences keep their source but may show quote prefixes; normalize nested context before expanding support.
    const block = codeBlocks(source)[0],
      language = block?.language ?? "",
      body = block?.body ?? source;
    if (language === "mermaid")
      return (
        <div onContextMenu={menu.open}>
          <Diagram source={body} dark={props.dark} />
          <button onClick={reveal}>Edit diagram source</button>
          {menuUI}
        </div>
      );
    return (
      <div onContextMenu={menu.open}>
        <CodeBlock
          text={body}
          language={language}
          dark={props.dark}
          edit={reveal}
          editLabel="Edit code source"
          preview={
            /^(md|markdown)$/i.test(language) ? (
              <Markdown
                doc={props.doc}
                value={body}
                onChange={(value) => change(replaceCodeBlock(source, source, 1, value))}
                open={props.open}
                dark={props.dark}
                vaultRoot={props.vaultRoot}
                embedded
              />
            ) : undefined
          }
        />
        {menuUI}
      </div>
    );
  }
  if (kind === "properties" || kind === "html")
    return (
      <div className="live-protected" onContextMenu={menu.open}>
        <Disclosure title={kind === "properties" ? "Properties" : "HTML source"}>
          <pre>{source}</pre>
        </Disclosure>
        <button onClick={reveal}>Edit source</button>
        {menuUI}
      </div>
    );
  return (
    <div onContextMenu={menu.open}>
      <button
        className="live-block-edit"
        aria-label={`Edit ${kind === "media" ? "media" : "table"} source`}
        onClick={reveal}
      >
        Edit source
      </button>
      {menuUI}
      {kind === "markdown" ? (
        <div className="live-table">
          <RichPreview
            doc={props.doc}
            value={source}
            onChange={change}
            open={props.open}
            dark={props.dark}
            vaultRoot={props.vaultRoot}
            embedded
            onFocus={activate}
          />
        </div>
      ) : (
        <Markdown
          doc={props.doc}
          value={source}
          onChange={change}
          open={props.open}
          dark={props.dark}
          vaultRoot={props.vaultRoot}
          embedded
        />
      )}
      {referenceEdit && (
        <ReferenceDialog
          reference={referenceEdit.reference}
          close={() => setReferenceEdit(null)}
          save={(reference) => {
            if (source !== referenceEdit.source) return "The note changed. Open the item again.";
            change(
              source.slice(0, reference.from) +
                referenceMarkdown(reference) +
                source.slice(reference.to),
            );
          }}
          remove={() => {
            if (source !== referenceEdit.source) return "The note changed. Open the item again.";
            change("");
          }}
        />
      )}
    </div>
  );
}
export function LiveNote(props: Props) {
  const active = useRef<RichControls | null>(null);
  const [, setActiveEditor] = useState<RichControls["editor"] | null>(null);
  const owned = () => {
    const value = active.current;
    return value && !value.editor.isDestroyed && value.editor.view.dom.isConnected ? value : null;
  };
  const latest = useRef(props);
  latest.current = props;
  const [options] = useState<LiveOptions>(() => ({
    sourceFocus: () => {
      active.current = null;
      setActiveEditor(null);
    },
    format: (action) => {
      if (action === "table") return false;
      const value = owned();
      if (!value) return false;
      if (value.editor.isEditable) value.format(action);
      return true;
    },
    undo: () => {
      const value = owned();
      if (!value) return false;
      if (value.editor.isEditable) value.editor.chain().focus().undo().run();
      return true;
    },
    redo: () => {
      const value = owned();
      if (!value) return false;
      if (value.editor.isEditable) value.editor.chain().focus().redo().run();
      return true;
    },
    canUndo: () => {
      const value = owned();
      return value ? value.editor.isEditable && value.editor.can().undo() : undefined;
    },
    canRedo: () => {
      const value = owned();
      return value ? value.editor.isEditable && value.editor.can().redo() : undefined;
    },
    get dark() {
      return latest.current.dark;
    },
    notify: (message) => latest.current.notify(message),
    open: (target) => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return;
      const path = resolveLink(
        latest.current.doc.path,
        /\.[a-z\d]+(?:#.*)?$/i.test(target) ? target : `${target}.md`,
        [],
      )?.path;
      if (path) latest.current.open(path);
    },
    render: (dom, source, kind, reveal, change) => {
      let root = roots.get(dom);
      if (!root) {
        root = createRoot(dom);
        roots.set(dom, root);
      }
      root.render(
        <Block
          source={source}
          kind={kind}
          props={{
            ...latest.current,
            open: (path) => latest.current.open(path),
          }}
          reveal={reveal}
          change={change}
          activate={(controls) => {
            active.current = controls;
            setActiveEditor(controls.editor);
          }}
        />,
      );
      return () => {
        roots.delete(dom);
        root.unmount();
      };
    },
  }));
  const crlf = props.value.includes("\r\n");
  return (
    <Editor
      cacheKey={props.cacheKey}
      value={props.value.replace(/\r\n/g, "\n")}
      onChange={(value) => props.onChange(crlf ? value.replace(/\n/g, "\r\n") : value)}
      fontSize={props.fontSize}
      isMarkdown
      livePreview={options}
      vaultRoot={props.vaultRoot}
      attachmentTarget={
        !props.doc.path.startsWith("draft://")
          ? { path: props.doc.path, root: props.vaultRoot }
          : undefined
      }
      position={{ mode: "preview", editorScroll: props.scroll }}
      onPosition={(position: Partial<ViewState>) => {
        if (position.editorScroll !== undefined) props.onScroll(position.editorScroll);
      }}
      notify={props.notify}
      toolbarEnd={props.toolbarEnd}
    />
  );
}
