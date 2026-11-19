import { Collapsible } from "radix-ui";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, FileText, MoreHorizontal, FilePlus2, FolderPlus } from "lucide-react";
import type { Entry } from "../shared/types";
import { Tooltip } from "./Tooltip";
import { FileIcon } from "./FileIcon";
import { FolderIcon } from "./FolderIcon";
export type TreeCreation = {
  root: string;
  parent: string;
  type: "file" | "folder";
  name: string;
  busy?: boolean;
  error?: string;
};
function InlineName({
  creation,
  change,
  commit,
  cancel,
}: {
  creation: TreeCreation;
  change: (name: string) => void;
  commit: () => void;
  cancel: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const end = creation.type === "file" ? creation.name.lastIndexOf(".") : creation.name.length;
    input.current?.setSelectionRange(0, end > 0 ? end : creation.name.length);
  }, []);
  return (
    <div className="inline-create">
      <div>
        {creation.type === "folder" ? <FolderIcon path={creation.name} /> : <FileText size={16} />}
        <input
          ref={input}
          aria-label={creation.type === "folder" ? "New folder name" : "New file name"}
          value={creation.name}
          disabled={creation.busy}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
        />
        <small>↵</small>
      </div>
      {creation.error && <p role="alert">{creation.error}</p>}
    </div>
  );
}
function Tree({
  entries,
  active,
  open,
  context,
  newFile,
  newFolder,
  selectedFolder,
  selectFolder,
  creation,
  changeCreation,
  commitCreation,
  cancelCreation,
  collapsed,
  setCollapsed,
}: {
  entries: Entry[];
  active: string;
  open: (path: string, pin?: boolean) => void;
  context: (path: string, directory: boolean, x: number, y: number) => void;
  newFile: (folder: string) => void;
  newFolder: (folder: string) => void;
  selectedFolder: string;
  selectFolder: (path: string) => void;
  creation: TreeCreation | null;
  changeCreation: (name: string) => void;
  commitCreation: () => void;
  cancelCreation: () => void;
  collapsed: Set<string>;
  setCollapsed: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const { folders, files } = useMemo(() => {
    const allFolders = new Set(entries.filter((e) => e.kind === "folder").map((e) => e.path));
    const folders = new Map<string, string[]>(),
      files = new Map<string, Entry[]>();
    for (const entry of entries) {
      const parts = entry.path.split("/");
      for (let i = 1; i < parts.length; i++) allFolders.add(parts.slice(0, i).join("/"));
      if (entry.kind !== "folder") {
        const parent = parts.slice(0, -1).join("/");
        if (!files.has(parent)) files.set(parent, []);
        files.get(parent)!.push(entry);
      }
    }
    for (const path of [...allFolders].sort()) {
      const parent = path.split("/").slice(0, -1).join("/");
      if (!folders.has(parent)) folders.set(parent, []);
      folders.get(parent)!.push(path);
    }
    return { folders, files };
  }, [entries]);
  useEffect(() => {
    if (creation)
      setCollapsed(
        (previous) =>
          new Set(
            [...previous].filter(
              (path) => creation.parent !== path && !creation.parent.startsWith(path + "/"),
            ),
          ),
      );
  }, [creation?.parent, creation?.type]);
  const menu = (e: React.MouseEvent, path: string, directory: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    selectFolder(directory ? path : path.split("/").slice(0, -1).join("/"));
    context(path, directory, e.clientX, e.clientY);
  };
  const level = (parent: string): React.ReactNode => (
    <>
      {creation?.parent === parent && (
        <InlineName
          key={`${creation.root}:${creation.parent}:${creation.type}`}
          creation={creation}
          change={changeCreation}
          commit={commitCreation}
          cancel={cancelCreation}
        />
      )}{" "}
      {(folders.get(parent) ?? []).map((path) => (
        <Collapsible.Root
          key={path}
          open={!collapsed.has(path)}
          className={`folder-node ${selectedFolder === path ? "folder-selected" : ""}`}
          onOpenChange={(isOpen) => {
            setCollapsed((previous) => {
              if (previous.has(path) === !isOpen) return previous;
              const next = new Set(previous);
              if (isOpen) next.delete(path);
              else next.add(path);
              return next;
            });
          }}
        >
          <div className="folder-heading" onContextMenu={(e) => menu(e, path, true)}>
            <Tooltip text={path}>
              <Collapsible.Trigger className="folder-trigger" onClick={() => selectFolder(path)}>
                <ChevronDown size={13} />
                <FolderIcon path={path} />
                <span>{path.split("/").pop()}</span>
              </Collapsible.Trigger>
            </Tooltip>
            <span className="folder-actions">
              <button
                aria-label={`New file in ${path}`}

                onClick={(e) => {
                  e.preventDefault();
                  selectFolder(path);
                  newFile(path);
                }}
              >
                <FilePlus2 size={13} />
              </button>
              <button
                aria-label={`Folder actions for ${path}`}

                onClick={(e) => menu(e, path, true)}
              >
                <MoreHorizontal size={13} />
              </button>
            </span>
          </div>
          <Collapsible.Content forceMount className="folder-children">
            {level(path)}
          </Collapsible.Content>
        </Collapsible.Root>
      ))}
      {(files.get(parent) ?? []).map((entry) => {
        return (
          <div
            className={`tree-file ${active === entry.path ? "selected" : ""}`}
            key={entry.path}
            onContextMenu={(e) => menu(e, entry.path, false)}
          >
            <Tooltip text={entry.path}>
              <button
                className="file-row"
                data-path={entry.path}
                onClick={(e) => {
                  selectFolder(parent);
                  open(entry.path, e.ctrlKey || e.metaKey);
                }}
                onDoubleClick={() => open(entry.path, true)}
                onAuxClick={(e) => {
                  if (e.button === 1) {
                    e.preventDefault();
                    open(entry.path, true);
                  }
                }}
              >
                <FileIcon path={entry.path} />
                <span>{entry.name.replace(/\.md$/, "")}</span>
                {["pdf", "image", "office"].includes(entry.kind) && <small>Preview</small>}
              </button>
            </Tooltip>
            <button
              className="file-more"
              aria-label={`Actions for ${entry.path}`}
              onClick={(e) => menu(e, entry.path, false)}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        );
      })}
    </>
  );
  return (
    <div
      className="file-tree"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) menu(e, "", true);
      }}
    >
      <div className="tree-section-title">
        <h4>Files</h4>
        <span>
          <button aria-label="New file" onClick={() => newFile(selectedFolder)}>
            <FilePlus2 size={15} />
          </button>
          <button
            aria-label="New folder"

            onClick={() => newFolder(selectedFolder)}
          >
            <FolderPlus size={15} />
          </button>
        </span>
      </div>
      {level("")}
    </div>
  );
}
const MemoTree = memo(Tree);
type TreeProps = Parameters<typeof Tree>[0];
export function FileTree(props: TreeProps) {
  const latest = useRef(props);
  latest.current = props;
  // Keep event handlers current without rerendering every file row on editor/scroll updates.
  const [actions] = useState(() => ({
    open: (...args: Parameters<TreeProps["open"]>) => latest.current.open(...args),
    context: (...args: Parameters<TreeProps["context"]>) => latest.current.context(...args),
    newFile: (...args: Parameters<TreeProps["newFile"]>) => latest.current.newFile(...args),
    newFolder: (...args: Parameters<TreeProps["newFolder"]>) => latest.current.newFolder(...args),
    selectFolder: (...args: Parameters<TreeProps["selectFolder"]>) =>
      latest.current.selectFolder(...args),
    changeCreation: (...args: Parameters<TreeProps["changeCreation"]>) =>
      latest.current.changeCreation(...args),
    commitCreation: () => latest.current.commitCreation(),
    cancelCreation: () => latest.current.cancelCreation(),
  }));
  return <MemoTree {...props} {...actions} />;
}
