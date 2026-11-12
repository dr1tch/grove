import { useState } from "react";
import type { Credentials } from "./auth";
import mark from "../../../resources/brand/grove-mark.svg";
export function SignIn({
  connect,
  previous,
  initialError = "",
}: {
  connect: (credentials: Credentials) => Promise<void>;
  previous?: Credentials;
  initialError?: string;
}) {
  const [owner, setOwner] = useState(previous?.ref.owner ?? ""),
    [repo, setRepo] = useState(previous?.ref.repo ?? ""),
    [branch, setBranch] = useState(previous?.ref.branch ?? "main"),
    [token, setToken] = useState("");
  const [remember, setRemember] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  return (
    <main className="web-sign-in">
      <section>
        <a className="web-brand" href="../">
          <img src={mark} alt="" width="45" height="45" />
          Grove
        </a>
        <h1>Your vault, in your browser.</h1>
        <p>Connect a private GitHub repository. Notes stay in their original format.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            void connect({
              ref: { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() },
              token: token.trim(),
              remember,
            })
              .catch((reason) =>
                setError(reason instanceof Error ? reason.message : "Could not connect"),
              )
              .finally(() => setBusy(false));
          }}
        >
          <label>
            GitHub owner
            <input
              name="owner"
              required
              autoComplete="off"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Repository
            <input
              name="repository"
              required
              autoComplete="off"
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Branch
            <input
              name="branch"
              required
              autoComplete="off"
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Fine-grained access token
            <input
              name="token"
              type="password"
              required
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={busy}
            />
          </label>
          <p className="web-help">
            Give the token Contents read and write access to this repository only. The token is sent
            only to api.github.com.
          </p>
          <a
            className="web-token-guide"
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noreferrer"
          >
            Create a fine-grained token
          </a>
          <label className="web-checkbox">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              disabled={busy}
            />
            Remember this browser
          </label>
          <p className="web-help">
            {remember
              ? "The token will be stored in this browser until you sign out. Use a trusted device."
              : "The token stays in this browser session. Local pending edits remain recoverable after sign-out."}
          </p>
          {error && (
            <p role="alert" className="web-error">
              {error}
            </p>
          )}
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Open vault"}
          </button>
        </form>
        <p className="web-help">No Grove account. No Grove server.</p>
      </section>
    </main>
  );
}
