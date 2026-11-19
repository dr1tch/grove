import { Dialog } from "../../../src/renderer/Dialog";
import { Cloud, LogOut, Plus, Trash2, X } from "lucide-react";
import { GitHubLogo } from "./SignIn";
import type { CloudCredentials, Credentials } from "./auth";
import type { SavedVault } from "./vaults";
import type { RepoRef } from "@grove/github-vault/types";
import { rootOf } from "@grove/github-vault/types";
export function AccountDialog({
  active,
  cloud,
  vaults,
  pending,
  busy,
  error,
  close,
  connect,
  open,
  forget,
  signOut,
  reload,
}: {
  active: Credentials;
  cloud?: CloudCredentials;
  vaults?: SavedVault[];
  pending: number;
  busy: boolean;
  error: string;
  close: () => void;
  connect: () => void;
  open: (ref: RepoRef | "cloud") => void;
  forget: (id: string) => void;
  signOut: () => void;
  reload: () => void;
}) {
  const activeRoot = active.kind === "github" ? rootOf(active.ref) : "cloud";
  return (
    <Dialog
      className="modal web-account web-account-dialog"
      label="Repository account"
      close={close}
      dismissible={!busy}
    >
      <header>
        <h2>Account</h2>
        <button className="icon" aria-label="Close" disabled={busy} onClick={close}>
          <X size={16} />
        </button>
      </header>
      <div className="web-account-who">
        <span className="web-avatar" aria-hidden="true">
          {(cloud?.email || "G").slice(0, 1).toUpperCase()}
        </span>
        <div>
          <strong>{cloud?.email || "GitHub token"}</strong>
          <small>{cloud ? "Signed in to Grove" : "Access token in this browser"}</small>
        </div>
      </div>
      <h3 className="web-account-label">Vaults</h3>
      <div className="web-vaults">
        {cloud && (
          <div className={`web-vault ${activeRoot === "cloud" ? "current" : ""}`}>
            <Cloud size={18} aria-hidden="true" />
            <div>
              <strong>Grove cloud</strong>
              <small>Notes stored by Grove</small>
            </div>
            {activeRoot === "cloud" ? (
              <span className="badge">Open</span>
            ) : (
              <button disabled={busy} onClick={() => open("cloud")}>
                Open
              </button>
            )}
          </div>
        )}
        {vaults?.map((vault) => (
          <div
            key={vault.id}
            className={`web-vault ${activeRoot === rootOf(vault) ? "current" : ""}`}
          >
            <GitHubLogo />
            <div>
              <strong>
                {vault.owner}/{vault.repo}
              </strong>
              <small>Branch {vault.branch}</small>
            </div>
            {activeRoot === rootOf(vault) ? (
              <span className="badge">Open</span>
            ) : (
              <button
                disabled={busy}
                aria-label={`Open ${vault.owner}/${vault.repo} (${vault.branch})`}
                onClick={() => open(vault)}
              >
                Open
              </button>
            )}
            <button
              className="icon"
              disabled={busy || activeRoot === rootOf(vault)}
              aria-label={`Remove ${vault.owner}/${vault.repo} (${vault.branch}) shortcut`}
              title="Remove shortcut only"
              onClick={() => forget(vault.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!cloud && active.kind === "github" && (
          <div className="web-vault current">
            <GitHubLogo />
            <div>
              <strong>
                {active.ref.owner}/{active.ref.repo}
              </strong>
              <small>Branch {active.ref.branch}</small>
            </div>
            <span className="badge">Open</span>
          </div>
        )}
      </div>
      {cloud && (
        <div className="web-vault-actions">
          <button disabled={busy} aria-label="Connect GitHub repository" onClick={connect}>
            <Plus size={15} />
            Add GitHub vault
          </button>
          <button className="web-link" disabled={busy} onClick={reload}>
            Refresh vaults
          </button>
        </div>
      )}
      {cloud && !vaults && !error && (
        <p role="status" className="web-account-note">
          Loading saved vaults…
        </p>
      )}
      <p className="web-account-note">
        {pending
          ? `${pending} local ${pending === 1 ? "change is" : "changes are"} waiting to sync. Pending work stays in this browser when you switch vaults.`
          : "Saved vault shortcuts follow your Grove account. Connect GitHub in this browser session to open them."}
      </p>
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
      <footer>
        <button className="web-sign-out" disabled={busy} onClick={signOut}>
          <LogOut size={15} />
          Sign out
        </button>
        <button className="primary" disabled={busy} onClick={close}>
          {busy ? "Opening…" : "Back to notes"}
        </button>
      </footer>
    </Dialog>
  );
}
