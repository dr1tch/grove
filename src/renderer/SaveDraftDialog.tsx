import { useState } from "react";
import { X } from "lucide-react";

/** Asks where to save a new note that so far only lives in its tab. */
export function SaveDraftDialog({
  title,
  folders,
  folder: initialFolder,
  closing,
  vaultName,
  save,
  discard,
  cancel,
}: {
  title: string;
  folders: string[];
  folder: string;
  closing: boolean;
  vaultName: string;
  save: (name: string, folder: string) => Promise<void>;
  discard: () => void;
  cancel: () => void;
}) {
  const [name, setName] = useState(title);
  const [folder, setFolder] = useState(initialFolder);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = /\.[^.]+$/.test(name.trim()) ? name.trim() : `${name.trim()}.md`;
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <section className="modal" role="dialog" aria-label="Save note">
        <header>
          <h2>{closing ? "Save this note before closing?" : "Save note"}</h2>
          <button aria-label="Close dialog" onClick={cancel}>
            <X />
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            save(name, folder).catch((reason) => {
              setError(String(reason).replace(/^Error: /, ""));
              setBusy(false);
            });
          }}
        >
          <label htmlFor="draft-name">Name</label>
          <input
            id="draft-name"
            autoFocus
            required
            value={name}
            disabled={busy}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="draft-folder">Folder</label>
          <select
            id="draft-folder"
            value={folder}
            disabled={busy}
            onChange={(e) => setFolder(e.target.value)}
          >
            <option value="">{vaultName}</option>
            {folders.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
          <p className="settings-help">Saves as {folder ? `${folder}/${file}` : file}</p>
          {error && <small className="danger-text">{error}</small>}
          <footer>
            <button type="button" onClick={discard} disabled={busy}>
              Discard
            </button>
            <button type="button" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>
              Save
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
