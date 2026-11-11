import { useEffect, useRef, useState } from "react";
import type { Entry, WorkspacePreset } from "../shared/types";
import { cleanPresets } from "../shared/workspaces";
export function Workspaces({
  root,
  entries,
  snapshot,
  apply,
  close,
}: {
  root: string;
  entries: Entry[];
  snapshot: () => Omit<WorkspacePreset, "id" | "name">;
  apply: (preset: WorkspacePreset) => Promise<void>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [presets, setPresets] = useState<WorkspacePreset[]>(() => {
      try {
        return cleanPresets(
          JSON.parse(localStorage.getItem(`folio:presets:${root}`) || "[]"),
          root,
        );
      } catch {
        return [];
      }
    }),
    [name, setName] = useState(""),
    [renaming, setRenaming] = useState(""),
    [pending, setPending] = useState<WorkspacePreset>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  const save = (next: WorkspacePreset[]) => {
    try {
      localStorage.setItem(`folio:presets:${root}`, JSON.stringify(next));
      setPresets(next);
      setError("");
      return true;
    } catch (error) {
      setError(String(error));
      return false;
    }
  };
  const missing = (preset: WorkspacePreset) =>
    [...new Set(preset.layout.panes.flatMap((p) => p.tabs))].filter(
      (path) => !entries.some((e) => e.path === path),
    );
  const open = (preset: WorkspacePreset) => {
    setBusy(true);
    void apply(preset)
      .then(close)
      .catch((error) => setError(String(error)))
      .finally(() => setBusy(false));
  };
  return (
    <dialog
      ref={dialog}
      className="workspace-dialog"
      aria-label="Workspaces"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <section>
        <header>
          <h2>Workspaces</h2>
          <button aria-label="Close workspaces" disabled={busy} onClick={close}>
            ×
          </button>
        </header>
        <p>
          Save tabs, panes and reading positions for this folder. Your notes stay in their files.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) return;
            if (
              presets.some(
                (p) =>
                  p.id !== renaming && p.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
              )
            ) {
              setError("Choose a different workspace name.");
              return;
            }
            const next = renaming
              ? presets.map((p) => (p.id === renaming ? { ...p, name: trimmed } : p))
              : [...presets, { ...snapshot(), id: crypto.randomUUID(), name: trimmed }];
            if (save(next)) {
              setName("");
              setRenaming("");
            }
          }}
        >
          <input
            aria-label="Workspace name"
            placeholder="Research, Coding, Writing…"
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" disabled={busy || !name.trim()}>
            {renaming ? "Save name" : "Save workspace"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <div className="workspace-list">
          {presets.map((preset) => (
            <section key={preset.id}>
              <div>
                <strong>{preset.name}</strong>
                <small>
                  {preset.layout.panes.length} panes ·{" "}
                  {new Set(preset.layout.panes.flatMap((p) => p.tabs)).size} files
                </small>
              </div>
              <button
                aria-label={`Open ${preset.name}`}
                disabled={busy}
                onClick={() => {
                  if (missing(preset).length) setPending(preset);
                  else open(preset);
                }}
              >
                Open
              </button>
              <button
                aria-label={`Rename ${preset.name}`}
                disabled={busy}
                onClick={() => {
                  setRenaming(preset.id);
                  setName(preset.name);
                }}
              >
                Rename
              </button>
              <button
                aria-label={`Delete ${preset.name}`}
                disabled={busy}
                onClick={() => save(presets.filter((p) => p.id !== preset.id))}
              >
                Delete
              </button>
            </section>
          ))}
        </div>
        {!presets.length && <p>No saved workspaces yet.</p>}
        {pending && (
          <div className="banner warning">
            <p>Missing files: {missing(pending).join(", ")}. Unsaved notes will stay open.</p>
            <button disabled={busy} onClick={() => open(pending)}>
              Open available files
            </button>
            <button disabled={busy} onClick={() => setPending(undefined)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </dialog>
  );
}
