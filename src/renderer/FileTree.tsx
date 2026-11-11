import { useEffect, useRef } from "react";
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
export function FileTree({
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
  const allFolders = new Set(entries.filter((e) => e.kind === "folder").map((e) => e.path));
  for (const e of entries) {
    const parts = e.path.split("/");
    for (let i = 1; i < parts.length; i++) allFolders.add(parts.slice(0, i).join("/"));
  }
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
      {[...allFolders]
        .filter((path) => path.split("/").slice(0, -1).join("/") === parent)
        .sort()
        .map((path) => (
          <details
            key={path}
            open={!collapsed.has(path)}
            className={`folder-node ${selectedFolder === path ? "folder-selected" : ""}`}
            onToggle={(e) => {
              const isOpen = e.currentTarget.open;
              setCollapsed((previous) => {
                if (previous.has(path) === !isOpen) return previous;
                const next = new Set(previous);
                if (isOpen) next.delete(path);
                else next.add(path);
                return next;
              });
            }}
          >
            <Tooltip text={path}>
              <summary
                onClick={() => selectFolder(path)}
                onContextMenu={(e) => menu(e, path, true)}
              >
                <ChevronDown size={13} />
                <FolderIcon path={path} />
                <span>{path.split("/").pop()}</span>
                <span className="folder-actions">
                  <button
                    aria-label={`New file in ${path}`}

                    onClick={(e) => {
                      e.preventDefault();
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
              </summary>
            </Tooltip>
            <div className="folder-children">{level(path)}</div>
          </details>
        ))}
      {entries
        .filter((e) => e.kind !== "folder" && e.path.split("/").slice(0, -1).join("/") === parent)
        .map((entry) => {
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
