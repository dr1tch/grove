import { useEffect } from "react";
import { ItemMenu, ItemMenuItem, ItemSubmenu, useItemMenu } from "./ItemMenu";
import type { Editor } from "@tiptap/core";
import { TableMap } from "@tiptap/pm/tables";
import { closeHistory } from "@tiptap/pm/history";
import {
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  IndentIncrease,
  IndentDecrease,
} from "lucide-react";

function columnAlignment(editor: Editor, align: "left" | "center" | "right") {
  const { $from } = editor.state.selection;
  let cell = $from.depth;
  while (cell && !["tableCell", "tableHeader"].includes($from.node(cell).type.name)) cell--;
  if (!cell) return;
  const table = $from.node(cell - 2),
    start = $from.start(cell - 2),
    map = TableMap.get(table);
  const column = map.findCell($from.before(cell) - start).left,
    transaction = editor.state.tr;
  for (let row = 0; row < map.height; row++) {
    const pos = start + map.positionAt(row, column, table),
      node = transaction.doc.nodeAt(pos);
    if (node) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, align });
  }
  editor.view.dispatch(closeHistory(transaction));
  editor.view.focus();
}
export function TableTools({
  editor,
  table,
  list,
  link,
  editLink,
}: {
  editor: Editor;
  table: boolean;
  list: string | null;
  link: boolean;
  editLink: () => void;
}) {
  const menu = useItemMenu(() => editor.state.selection);
  useEffect(() => {
    if (!menu.point) return;
    const check = () => {
      if (!menu.isCurrent() || !editor.isEditable) menu.close();
    };
    editor.on("transaction", check);
    return () => {
      editor.off("transaction", check);
    };
  }, [editor, menu.point, menu.close]);
  useEffect(() => {
    const element = editor.view.dom;
    const open = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const node = target?.closest("[data-node-view-wrapper],.cm-editor");
      if (!target || (node && element.contains(node)) || target.closest(".tiptap") !== element)
        return;
      const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (position) editor.commands.setTextSelection(position.pos);
      if (
        !editor.isActive("table") &&
        !editor.isActive("link") &&
        !editor.isActive("listItem") &&
        !editor.isActive("taskItem") &&
        !editor.isActive("blockquote")
      )
        return;
      menu.open(event);
    };
    element.addEventListener("contextmenu", open);
    return () => element.removeEventListener("contextmenu", open);
  }, [editor]);
  const run = (
    action:
      | "addRowBefore"
      | "addRowAfter"
      | "deleteRow"
      | "addColumnBefore"
      | "addColumnAfter"
      | "deleteColumn"
      | "deleteTable",
  ) => {
    if (!menu.isCurrent() || !editor.isEditable) {
      menu.close();
      return;
    }
    editor.view.dispatch(closeHistory(editor.state.tr));
    editor
      .chain()
      .focus()
      [action]()
      .command(({ tr }) => {
        // Keep Markdown's header promotion in the same undo step as row deletion.
        if (action === "deleteRow") {
          const { $from } = tr.selection;
          for (let depth = $from.depth; depth > 0; depth--)
            if ($from.node(depth).type.name === "table") {
              const row = $from.node(depth).firstChild;
              if (row?.firstChild?.type.name === "tableCell")
                row.forEach((cell, offset) =>
                  tr.setNodeMarkup(
                    $from.before(depth) + 2 + offset,
                    editor.schema.nodes.tableHeader,
                    cell.attrs,
                  ),
                );
              break;
            }
        }
        return true;
      })
      .run();
  };
  if (!menu.point) return null;
  const act = (action: () => unknown) => {
    if (menu.isCurrent() && editor.isEditable) action();
  };
  return (
    <ItemMenu
      point={menu.point}
      close={menu.close}
      label={table ? "Table actions" : "Item actions"}
    >
      {table && (
        <>
          <ItemSubmenu label="Row">
            <ItemMenuItem onClick={() => run("addRowBefore")}>Insert row above</ItemMenuItem>
            <ItemMenuItem onClick={() => run("addRowAfter")}>Insert row below</ItemMenuItem>
            <ItemMenuItem onClick={() => run("deleteRow")}>Delete row</ItemMenuItem>
          </ItemSubmenu>
          <ItemSubmenu label="Column">
            <ItemMenuItem onClick={() => run("addColumnBefore")}>Insert column left</ItemMenuItem>
            <ItemMenuItem onClick={() => run("addColumnAfter")}>Insert column right</ItemMenuItem>
            <ItemMenuItem onClick={() => run("deleteColumn")}>Delete column</ItemMenuItem>
          </ItemSubmenu>
          {(
            [
              ["left", AlignLeft],
              ["center", AlignCenter],
              ["right", AlignRight],
            ] as const
          ).map(([align, Icon]) => (
            <ItemMenuItem
              key={align}
              aria-label={`Align column ${align}`}
              onClick={() => act(() => columnAlignment(editor, align))}
            >
              <Icon /> {`Align column ${align}`}
            </ItemMenuItem>
          ))}
          <ItemMenuItem aria-label="Delete table" onClick={() => run("deleteTable")}>
            <Trash2 /> Delete table
          </ItemMenuItem>
        </>
      )}
      {link && (
        <>
          <ItemMenuItem onClick={() => act(editLink)}>Edit link</ItemMenuItem>
          <ItemMenuItem
            onClick={() =>
              act(() => editor.chain().focus().extendMarkRange("link").unsetLink().run())
            }
          >
            Remove link
          </ItemMenuItem>
        </>
      )}
      {list && (
        <>
          <ItemMenuItem
            aria-label="Indent item"
            disabled={!editor.can().sinkListItem(list)}
            onClick={() => act(() => editor.chain().focus().sinkListItem(list).run())}
          >
            <IndentIncrease /> Indent item
          </ItemMenuItem>
          <ItemMenuItem
            aria-label="Outdent item"
            disabled={!editor.can().liftListItem(list)}
            onClick={() => act(() => editor.chain().focus().liftListItem(list).run())}
          >
            <IndentDecrease /> Outdent item
          </ItemMenuItem>
        </>
      )}
      {editor.isActive("blockquote") && (
        <ItemMenuItem onClick={() => act(() => editor.chain().focus().toggleBlockquote().run())}>
          Remove quote
        </ItemMenuItem>
      )}
    </ItemMenu>
  );
}
