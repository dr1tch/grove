import { useEffect, useRef, useState } from "react";
import type { ExportRequest, PreparedExport } from "../shared/types";
export function ExportDialog({
  path,
  content,
  root,
  close,
  notify,
}: {
  path: string;
  content: string;
  root: string;
  close: () => void;
  notify: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    preparedRef = useRef<PreparedExport | undefined>(undefined);
  const [snapshot] = useState({ path, content }),
    [format, setFormat] = useState<ExportRequest["format"]>("html"),
    [theme, setTheme] = useState<ExportRequest["theme"]>("light"),
    [prepared, setPrepared] = useState<PreparedExport>(),
    [omissions, setOmissions] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current!.showModal();
    return () => {
      void window.folio.cancelExport(preparedRef.current?.id || "", root).catch(() => {});
    };
  }, []);
  const reset = () => {
    if (preparedRef.current)
      void window.folio.cancelExport(preparedRef.current.id, root).catch(() => {});
    preparedRef.current = undefined;
    setPrepared(undefined);
    setOmissions(false);
  };
  return (
    <dialog
      ref={dialog}
      className="export-dialog workspace-dialog"
      aria-label="Export note"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section>
        <header>
          <h2>Export {path.split("/").pop()}</h2>
          <button aria-label="Close export" onClick={close}>
            ×
          </button>
        </header>
        <p>
          Exports this note snapshot with its images, diagrams and local attachments. Embedded data
          is limited to 100 MiB. Replacing an export keeps its previous file as a recovery copy.
        </p>
        <label>
          Format{" "}
          <select
            aria-label="Export format"
            value={format}
            disabled={busy}
            onChange={(e) => {
              reset();
              setFormat(e.target.value as ExportRequest["format"]);
            }}
          >
            <option value="html">Self-contained HTML</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
        <label>
          Theme{" "}
          <select
            aria-label="Export theme"
            value={theme}
            disabled={busy}
            onChange={(e) => {
              reset();
              setTheme(e.target.value as ExportRequest["theme"]);
            }}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        {prepared && (
          <div className="export-summary">
            <p>Ready · {(prepared.size / 1024 / 1024).toFixed(2)} MiB</p>
            {prepared.warnings.length > 0 && (
              <>
                <ul>
                  {prepared.warnings.map((warning, i) => (
                    <li key={i}>{warning}</li>
                  ))}
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={omissions}
                    onChange={(e) => setOmissions(e.target.checked)}
                  />{" "}
                  Export without the listed missing or oversized assets
                </label>
              </>
            )}
          </div>
        )}
        <footer>
          <button onClick={close}>Cancel</button>
          {!prepared ? (
            <button
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void window.folio
                  .prepareExport({ ...snapshot, format, theme }, root)
                  .then((result) => {
                    preparedRef.current = result;
                    setPrepared(result);
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Preparing…" : "Prepare export"}
            </button>
          ) : (
            <button
              className="primary"
              disabled={busy || (prepared.warnings.length > 0 && !omissions)}
              onClick={() => {
                setBusy(true);
                void window.folio
                  .finishExport(prepared.id, omissions, root)
                  .then((result) => {
                    if (result.saved) {
                      notify(
                        result.backup
                          ? `Export saved. Previous file kept at ${result.backup}`
                          : "Export saved.",
                      );
                      close();
                    }
                  })
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              Save export…
            </button>
          )}
        </footer>
      </section>
    </dialog>
  );
}
