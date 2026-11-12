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
}: {
  format: (action: MarkdownAction) => void;
  insert?: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown formatting">
      <select
        aria-label="Heading"
        value=""
        onChange={(event) => format(event.target.value as MarkdownAction)}
      >
        <option value="" disabled>
          H
        </option>
        <option value="h0">Paragraph</option>
        {[1, 2, 3, 4, 5, 6].map((level) => (
          <option key={level} value={`h${level}`}>
            Heading {level}
          </option>
        ))}
      </select>
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
        ] as const
      ).map(([action, label, Icon]) => (
        <Tooltip
          key={action}
          text={label + (action === "bold" ? " (Ctrl+B)" : action === "italic" ? " (Ctrl+I)" : "")}
        >
          <button
            type="button"
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => format(action)}
          >
            <Icon />
          </button>
        </Tooltip>
      ))}
      {insert && (
        <>
          <span className="toolbar-divider" />
          <Tooltip text="Insert existing media, drawings or Mermaid blocks">
            <button
              type="button"
              aria-label="Insert from vault"
              onMouseDown={(event) => event.preventDefault()}
              onClick={insert}
            >
              <Paperclip />
              <span>Insert</span>
            </button>
          </Tooltip>
        </>
      )}
      <span className="toolbar-divider" />
      <Tooltip text="Undo (Ctrl+Z)">
        <button
          type="button"
          aria-label="Undo"
          disabled={!canUndo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={undo}
        >
          <Undo2 />
        </button>
      </Tooltip>
      <Tooltip text="Redo (Ctrl+Shift+Z)">
        <button
          type="button"
          aria-label="Redo"
          disabled={!canRedo}
          onMouseDown={(event) => event.preventDefault()}
          onClick={redo}
        >
          <Redo2 />
        </button>
      </Tooltip>
    </div>
  );
}
