import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/source-serif-4/latin-400.css";
import "@fontsource/source-serif-4/latin-400-italic.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "@fontsource/jetbrains-mono/latin-700.css";
import "../../../src/renderer/styles.css";
import "./web.css";
import { SignIn } from "./SignIn";
import { forgetCredentials, openVault, rememberCredentials, storedCredentials } from "./auth";
import type { Credentials } from "./auth";
import { createWebBridge } from "./bridge";
import { GitHubError } from "@grove/github-vault/types";
const DesktopApp = lazy(() =>
  import("../../../src/renderer/App").then((module) => ({ default: module.App })),
);
document.documentElement.dataset.platform = "web";
window.folio = createWebBridge();
function Root() {
  const [active, setActive] = useState<{
    credentials: Credentials;
    vault: Awaited<ReturnType<typeof openVault>>;
    bridge: ReturnType<typeof createWebBridge>;
  }>();
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [account, setAccount] = useState(false),
    [pending, setPending] = useState(0);
  const previous = useRef(storedCredentials());
  const mounted = useRef(true);
  const live = useRef(active);
  live.current = active;
  const activate = async (credentials: Credentials, resume = false) => {
    const vault = await openVault(credentials, resume);
    if (!mounted.current) {
      vault.session.dispose();
      await vault.cache.close();
      return;
    }
    try {
      if (!resume) rememberCredentials(credentials);
    } catch {
      vault.session.dispose();
      await vault.cache.close();
      throw new Error(
        "Browser could not store the connection. Check storage access before retrying.",
      );
    }
    const bridge = createWebBridge(vault.session);
    window.folio = bridge;
    setActive({ credentials, vault, bridge });
    setError("");
    bridge.start();
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (previous.current && !cancelled) await activate(previous.current, true);
      } catch (reason) {
        // Only a rejected token is forgotten; rate limits, outages and storage errors keep it.
        if (
          reason instanceof GitHubError &&
          ["auth", "no-access", "not-found"].includes(reason.kind)
        ) {
          forgetCredentials();
          if (previous.current) previous.current = { ...previous.current, token: "" };
        }
        setError(reason instanceof Error ? reason.message : "Reconnect to your vault");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      live.current?.bridge.dispose();
      void live.current?.vault.cache.close();
    };
  }, []);
  const signOut = async () => {
    if (!active) return;
    if (!active.bridge.canSignOut()) {
      setError("Save or discard your new draft before signing out.");
      return;
    }
    forgetCredentials();
    previous.current = { ...active.credentials, token: "" };
    active.bridge.dispose();
    await active.vault.cache.close();
    window.folio = createWebBridge();
    setActive(undefined);
    setAccount(false);
    setError("");
  };
  if (loading)
    return (
      <main className="web-loading" role="status">
        Opening Grove…
      </main>
    );
  if (!active)
    return (
      <SignIn
        previous={previous.current}
        initialError={error}
        connect={(credentials) => activate(credentials)}
      />
    );
  return (
    <>
      <Suspense
        fallback={
          <main className="web-loading" role="status">
            Opening your vault…
          </main>
        }
      >
        <DesktopApp
          account={
            <button
              className="web-account-button"
              aria-label="Repository account"
              onClick={() => {
                setAccount(true);
                setError("");
                void active.vault.cache.pending().then((edits) => setPending(edits.length));
              }}
            >
              Account
            </button>
          }
        />
      </Suspense>
      {account && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Repository account"
            className="modal web-account"
          >
            <h2>Repository account</h2>
            <p>
              {active.credentials.ref.owner}/{active.credentials.ref.repo} ·{" "}
              {active.credentials.ref.branch}
            </p>
            <p>
              {pending
                ? `${pending} local changes are waiting to sync. They stay in this browser after sign-out. Reconnect to this repository to recover them.`
                : "Your saved vault cache stays in this browser. Signing out removes the access token."}
            </p>
            {error && (
              <p role="alert" className="web-error">
                {error}
              </p>
            )}
            <footer>
              <button onClick={() => setAccount(false)}>Back to notes</button>
              <button onClick={() => void signOut().catch((reason) => setError(String(reason)))}>
                Sign out
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
if ("serviceWorker" in navigator)
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch(() => {});
