import { SelectField } from "./Controls";
import { Toolbar } from "radix-ui";
import {
  Bold,
  Italic,
  Quote,
  Code,
  Link2,
  List,
  ListOrdered,
  ListChecks,
  Paperclip,
  Undo2,
  Redo2,
  Table2,
} from "lucide-react";
import type { MarkdownAction } from "../shared/markdown-format";
import { Tooltip } from "./Tooltip";

export function MarkdownToolbar({
  format,
  insert,
  undo,
  redo,
  canUndo,
  canRedo,
  children,
}: {
  format: (action: MarkdownAction) => void;
  insert?: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  children?: React.ReactNode;
}) {
  return (
    <Toolbar.Root className="markdown-toolbar" aria-label="Markdown formatting">
      <SelectField
        aria-label="Heading"
        value=""
        onValueChange={(value) => format(value as MarkdownAction)}
        options={[
          { value: "", label: "H", disabled: true },
          { value: "h0", label: "Paragraph" },
          ...[1, 2, 3, 4, 5, 6].map((level) => ({
            value: `h${level}`,
            label: `Heading ${level}`,
          })),
        ]}
      />
      {(
        [
          ["bold", "Bold", Bold],
          ["italic", "Italic", Italic],
          ["quote", "Quote", Quote],
          ["code", "Code", Code],
          ["link", "Link", Link2],
          ["bullet", "Bulleted list", List],
          ["ordered", "Numbered list", ListOrdered],
          ["task", "Task list", ListChecks],
          ["table", "Insert table", Table2],
        ] as const
      ).map(([action, label, Icon]) => (
        <Tooltip
          key={action}
          text={label + (action === "bold" ? " (Ctrl+B)" : action === "italic" ? " (Ctrl+I)" : "")}
        >
          <Toolbar.Button
            type="button"
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(action)}
          >
            <Icon />
          </Toolbar.Button>
        </Tooltip>
      ))}
      {insert && (
        <>
          <span className="toolbar-divider" />
          <Tooltip text="Insert existing media, drawings or Mermaid blocks">
            <Toolbar.Button
              type="button"
              aria-label="Insert from vault"
              onMouseDown={(event) => event.preventDefault()}
              onClick={insert}
            >
              <Paperclip />
              <span>Insert</span>
            </Toolbar.Button>
          </Tooltip>
        </>
      )}
      <span className="toolbar-divider" />
      <Tooltip text="Undo (Ctrl+Z)">
        <Toolbar.Button
          type="button"
          aria-label="Undo"
          disabled={!canUndo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={undo}
        >
          <Undo2 />
        </Toolbar.Button>
      </Tooltip>
      <Tooltip text="Redo (Ctrl+Shift+Z)">
        <Toolbar.Button
          type="button"
          aria-label="Redo"
          disabled={!canRedo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={redo}
        >
          <Redo2 />
        </Toolbar.Button>
      </Tooltip>
      {children}
    </Toolbar.Root>
  );
}
