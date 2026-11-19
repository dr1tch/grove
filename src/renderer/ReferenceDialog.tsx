import { Dialog } from "./Dialog";
import { useState } from "react";
import type { Reference } from "./markdown-reference";
import { validReference } from "./markdown-reference";

export function ReferenceDialog({
  reference,
  save,
  remove,
  close,
}: {
  reference: Reference;
  save: (reference: Reference) => string | void;
  remove?: () => string | void;
  close: () => void;
}) {
  const [value, setValue] = useState(reference),
    [error, setError] = useState("");
  const media = value.kind === "image" || value.kind === "embed";
  const apply = () => {
    const next = { ...value, address: value.address.trim() };
    if (!validReference(next)) {
      setError(
        "Enter a note or file path, or an http, https or mailto address. Wiki targets cannot contain brackets or pipes.",
      );
      return;
    }
    const problem = save(next);
    if (problem) setError(problem);
    else close();
  };
  return (
    <Dialog
      className="modal rich-link-dialog"
      label={media ? "Edit media" : "Edit link"}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label>
          {media ? "File or image address" : "Link address"}
          <input
            autoFocus
            value={value.address}
            onChange={(event) => setValue({ ...value, address: event.target.value })}
          />
        </label>
        <label>
          {media ? "Description or size" : "Link text"}
          <input
            value={value.label}
            onChange={(event) => setValue({ ...value, label: event.target.value })}
          />
        </label>
        {(value.kind === "link" || value.kind === "image") && (
          <label>
            Title
            <input
              value={value.title}
              onChange={(event) => setValue({ ...value, title: event.target.value })}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
        <footer>
          {remove && (
            <button
              type="button"
              onClick={() => {
                const problem = remove();
                if (problem) setError(problem);
                else close();
              }}
            >
              Remove {media ? "embed" : "link"}
            </button>
          )}
          <button type="button" onClick={close}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Apply
          </button>
        </footer>
      </form>
    </Dialog>
  );
}
