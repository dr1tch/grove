import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SyncConnectRequest, SyncStatus } from "../shared/types";

const folderName = (root: string) => root.split("/").filter(Boolean).pop() || "notes";

export function SyncSettings({ root, changed }: { root: string; changed?: () => void }) {
  const [status, setStatus] = useState<SyncStatus>();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<"" | "create" | "existing">("");
  const [name, setName] = useState(folderName(root));
  const [url, setUrl] = useState("");
  const [dirty, setDirty] = useState<{
    count: number;
    request: SyncConnectRequest;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // A cycle that was running when sync was turned off must not flip the view back on.
  const live = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const state = await window.folio.state();
        const on = !!state.sync?.[root]?.enabled;
        live.current = on;
        if (cancelled) return;
        setEnabled(on);
        setStatus(await window.folio.syncStatus(root));
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    const off = window.folio.onSync((next) => {
      if (live.current) setStatus(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [root]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const connect = (request: SyncConnectRequest) =>
    run(async () => {
      const result = await window.folio.syncConnect(request, root);
      if ("needsConfirm" in result) {
        setDirty({ count: result.needsConfirm, request });
        return;
      }
      setDirty(undefined);
      if (result.state === "error" || !result.remote) {
        setStatus(result);
        return;
      }
      live.current = true;
      setEnabled(true);
      setStatus(result);
      setMode("");
      changed?.();
    });
  const problem = status && (status.state === "error" || status.state === "offline");
  if (!enabled) {
    return (
      <>
        <p className="settings-intro">Keep this vault backed up and in step across devices.</p>
        <h3 className="sync-heading">Sync this vault with GitHub</h3>
        {dirty ? (
          <div className="sync-box">
            <p>
              This folder is already a git repository with {dirty.count} uncommitted changes. Grove
              will commit them and sync from now on.
            </p>
            <div className="actions">
              <button
                className="primary"
                disabled={busy}
                onClick={() => void connect({ ...dirty.request, confirmDirty: true })}
              >
                Commit and sync
              </button>
              <button disabled={busy} onClick={() => setDirty(undefined)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="actions">
              <button
                className={mode === "create" ? "chosen" : ""}
                onClick={() => setMode("create")}
              >
                Create private repository
              </button>
              <button
                className={mode === "existing" ? "chosen" : ""}
                onClick={() => setMode("existing")}
              >
                Use existing repository
              </button>
            </div>
            {mode && (
              <form
                className="sync-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void connect(
                    mode === "create" ? { createName: name.trim() } : { url: url.trim() },
                  );
                }}
              >
                {mode === "create" ? (
                  <input
                    aria-label="Repository name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <input
                    aria-label="Repository URL"
                    placeholder="https://github.com/you/notes.git"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    autoFocus
                  />
                )}
                <button
                  type="submit"
                  className="primary"
                  disabled={busy || !(mode === "create" ? name.trim() : url.trim())}
                >
                  {busy ? "Connecting…" : mode === "create" ? "Create" : "Connect"}
                </button>
              </form>
            )}
          </>
        )}
        {error && <small className="danger-text">{error}</small>}
        {status && status.state === "error" && (
          <small className="danger-text">{status.message}</small>
        )}
      </>
    );
  }
  return (
    <>
      <p className="settings-intro">Your vault is synced with GitHub.</p>
      <div className="settings-detail">
        <strong>Remote</strong>
        <span className="sync-value">{status?.remote ?? ""}</span>
      </div>
      <div className="settings-detail">
        <strong>Branch</strong>
        <span>{status?.branch ?? ""}</span>
      </div>
      <div className="settings-detail">
        <strong>Last sync</strong>
        <span>{status?.lastSync ? new Date(status.lastSync).toLocaleString() : "Not yet"}</span>
      </div>
      {problem && status?.message && (
        <small className={status.state === "error" ? "danger-text" : "warning-text"}>
          {status.message}
        </small>
      )}
      {error && <small className="danger-text">{error}</small>}
      {!!status?.skipped.length && (
        <p className="settings-help">Not synced (over 50 MB): {status.skipped.join(", ")}</p>
      )}
      <div className="actions sync-actions">
        <button
          className="primary"
          disabled={busy || status?.state === "syncing"}
          onClick={() =>
            void run(async () => {
              setStatus(await window.folio.syncNow(root));
            })
          }
        >
          <RefreshCw size={14} /> Sync now
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              live.current = false;
              setEnabled(false);
              setStatus(await window.folio.syncDisable(root));
              changed?.();
            })
          }
        >
          Turn off sync
        </button>
      </div>
      <p className="settings-help sync-note">Your files and git history stay as they are.</p>
    </>
  );
}
