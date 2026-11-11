import { useEffect, useRef, useState } from "react";
import { diffLines } from "diff";
export function RecoveryDialog({
  title,
  left,
  right,
  actions,
  close,
}: {
  title: string;
  left: { label: string; text: string };
  right: { label: string; text: string };
  actions: { label: string; primary?: boolean; run: () => Promise<void> }[];
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    dialog.current!.showModal();
  }, []);
  const diff = diffLines(left.text, right.text);
  return (
    <dialog
      ref={dialog}
      className="recovery-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <section>
        <header>
          <h2>{title}</h2>
          <button aria-label="Close comparison" disabled={busy} onClick={close}>
            ×
          </button>
        </header>
        <p>
          Review before applying. Originals and newer edits are kept in history or recovery drafts.
        </p>
        <div className="recovery-columns">
          <section>
            <h3>{left.label}</h3>
            <pre>
              {diff
                .filter((part) => !part.added)
                .map((part, i) => (
                  <span key={i} className={part.removed ? "diff-del" : ""}>
                    {part.value}
                  </span>
                ))}
            </pre>
          </section>
          <section>
            <h3>{right.label}</h3>
            <pre>
              {diff
                .filter((part) => !part.removed)
                .map((part, i) => (
                  <span key={i} className={part.added ? "diff-add" : ""}>
                    {part.value}
                  </span>
                ))}
            </pre>
          </section>
        </div>
        {error && (
          <p role="alert" className="danger-text">
            {error}
          </p>
        )}
        <footer>
          <button disabled={busy} onClick={close}>
            Cancel
          </button>
          {actions.map((action) => (
            <button
              key={action.label}
              className={action.primary ? "primary" : ""}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void action
                  .run()
                  .then(close)
                  .catch((error) => setError(String(error)))
                  .finally(() => setBusy(false));
              }}
            >
              {action.label}
            </button>
          ))}
        </footer>
      </section>
    </dialog>
  );
}
