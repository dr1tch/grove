import { useEffect, useState } from "react";
import type { LinkRef, RenamePlan } from "../shared/types";
export function Backlinks({
  root,
  path,
  open,
  close,
  apply,
}: {
  root: string;
  path: string;
  open: (path: string) => void;
  close: () => void;
  apply: (plan: RenamePlan) => Promise<void>;
}) {
  const [data, setData] = useState<{
      incoming: LinkRef[];
      outgoing: LinkRef[];
      broken: LinkRef[];
    }>(),
    [recovery, setRecovery] = useState<RenamePlan | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      void Promise.all([window.folio.linksFor(path, root), window.folio.linkRenameRecovery(root)])
        .then(([data, recovery]) => {
          if (live) {
            setData(data);
            setRecovery(recovery);
          }
        })
        .catch((error) => {
          if (live) setError(String(error));
        });
    };
    refresh();
    const off = window.folio.onChange(refresh);
    return () => {
      live = false;
      off();
    };
  }, [root, path]);
  return (
    <section className="backlinks-panel">
      <header>
        <strong>Links · saved notes</strong>
        <button aria-label="Close backlinks" onClick={close}>
          ×
        </button>
      </header>
      {error && <p role="alert">{error}</p>}
      {recovery && (
        <div className="banner warning">
          <p>
            Interrupted rename: {recovery.source} → {recovery.target}.{" "}
            {recovery.files.filter((f) => f.done).length}/{recovery.files.length} link updates
            completed. Original text and newer edits are retained.
          </p>
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void apply(recovery)
                .then(() => {
                  setRecovery(null);
                  setError("");
                })
                .catch((error) => setError(String(error)))
                .finally(() => setBusy(false));
            }}
          >
            Resume link updates
          </button>
        </div>
      )}
      {!data ? (
        <p>Reading links…</p>
      ) : (
        <div className="links-columns">
          <section>
            <h4>Backlinks ({data.incoming.length})</h4>
            {data.incoming.map((ref, i) => (
              <button key={i} onClick={() => open(ref.sourcePath)}>
                {ref.sourcePath}
              </button>
            ))}
          </section>
          <section>
            <h4>Outgoing ({data.outgoing.length})</h4>
            {data.outgoing.map((ref, i) => (
              <button
                key={i}
                disabled={ref.missing || ref.ambiguous}
                onClick={() => open(ref.targetPath)}
              >
                {ref.raw}
                {ref.ambiguous ? " · Ambiguous" : ref.missing ? " · Missing" : ""}
              </button>
            ))}
          </section>
          <section>
            <h4>Unresolved in vault ({data.broken.length})</h4>
            {data.broken.map((ref, i) => (
              <button key={i} onClick={() => open(ref.sourcePath)}>
                {ref.sourcePath}: {ref.raw} · {ref.ambiguous ? "Ambiguous" : "Missing"}
              </button>
            ))}
          </section>
        </div>
      )}
    </section>
  );
}
