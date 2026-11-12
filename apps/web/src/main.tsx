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
import { GitHubLogo, SignIn } from "./SignIn";
import { Cloud, LogOut, X } from "lucide-react";
import {
  accounts,
  cloudCredentials,
  connectGitHub,
  connectingGitHub,
  returnedError,
  forgetCredentials,
  githubToken,
  openVault,
  rememberCredentials,
  resettingPassword,
  signOutAccount,
  storedCredentials,
} from "./auth";
import type { CloudCredentials, Credentials } from "./auth";
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
    [pending, setPending] = useState(0),
    [github, setGithub] = useState<string>(),
    [cloud, setCloud] = useState<CloudCredentials>(),
    [recovering, setRecovering] = useState(resettingPassword);
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
    setGithub(undefined);
    setRecovering(false);
    if (credentials.kind === "cloud") setCloud(credentials);
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
        if (resettingPassword) return;
        // Waits for Supabase to finish an OAuth or email-link redirect, if one is in the URL.
        const session = accounts ? (await accounts.auth.getSession()).data.session : null;
        if (cancelled) return;
        const token = githubToken(session),
          stored = previous.current;
        if (session) setCloud(cloudCredentials(session));
        if (connectingGitHub || returnedError)
          history.replaceState(null, "", import.meta.env.BASE_URL);
        if (token && !(stored?.kind === "github" && stored.token === token)) {
          setGithub(token);
          return;
        }
        if (stored?.kind === "cloud" && session && session.user.id !== stored.userId)
          await activate(cloudCredentials(session));
        else if (stored) await activate(stored, true);
        else if (session) await activate(cloudCredentials(session));
        // A failed GitHub link returns here still signed in: show why in the Account dialog.
        if (returnedError) {
          setError(returnedError);
          setAccount(Boolean(stored || session));
        }
      } catch (reason) {
        // Only a rejected token is forgotten; rate limits, outages and storage errors keep it.
        if (
          reason instanceof GitHubError &&
          ["auth", "no-access", "not-found"].includes(reason.kind)
        ) {
          forgetCredentials();
          if (previous.current?.kind === "github")
            previous.current = { ...previous.current, token: "" };
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
  // Opens another vault for the same person; queued edits stay in this browser's cache.
  const switchTo = async (credentials: Credentials) => {
    if (!active) return;
    if (!active.bridge.canSignOut()) {
      setError("Save or discard your new draft before switching vaults.");
      return;
    }
    active.bridge.dispose();
    await active.vault.cache.close();
    window.folio = createWebBridge();
    setActive(undefined);
    setAccount(false);
    setLoading(true);
    try {
      await activate(credentials);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open that vault");
    } finally {
      setLoading(false);
    }
  };
  const signOut = async () => {
    if (!active) return;
    if (!active.bridge.canSignOut()) {
      setError("Save or discard your new draft before signing out.");
      return;
    }
    forgetCredentials();
    await signOutAccount();
    previous.current =
      active.credentials.kind === "github" ? { ...active.credentials, token: "" } : undefined;
    setCloud(undefined);
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
        github={github}
        cloud={cloud}
        recovering={recovering}
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
        <div
          className="modal-backdrop"
          onClick={(event) => event.target === event.currentTarget && setAccount(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Repository account"
            className="modal web-account"
          >
            <header>
              <h2>Account</h2>
              <button className="icon" aria-label="Close" onClick={() => setAccount(false)}>
                <X size={16} />
              </button>
            </header>
            <div className="web-account-who">
              <span className="web-avatar" aria-hidden="true">
                {(cloud?.email || "G").slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{cloud?.email || "GitHub token"}</strong>
                <small>
                  {cloud ? "Signed in to Grove" : "Signed in with an access token in this browser"}
                </small>
              </div>
            </div>
            <h3 className="web-account-label">Vaults</h3>
            <div className="web-vaults">
              {(cloud || active.credentials.kind === "cloud") && (
                <div
                  className={`web-vault ${active.credentials.kind === "cloud" ? "current" : ""}`}
                >
                  <Cloud size={18} aria-hidden="true" />
                  <div>
                    <strong>Grove cloud</strong>
                    <small>Notes stored by Grove</small>
                  </div>
                  {active.credentials.kind === "cloud" ? (
                    <span className="badge">Open</span>
                  ) : (
                    <button onClick={() => void switchTo(cloud!)}>Use Grove cloud</button>
                  )}
                </div>
              )}
              <div className={`web-vault ${active.credentials.kind === "github" ? "current" : ""}`}>
                <GitHubLogo />
                <div>
                  <strong>
                    {active.credentials.kind === "github"
                      ? `${active.credentials.ref.owner}/${active.credentials.ref.repo}`
                      : "GitHub repository"}
                  </strong>
                  <small>
                    {active.credentials.kind === "github"
                      ? `Branch ${active.credentials.ref.branch}`
                      : "Keep notes in a repository you own"}
                  </small>
                </div>
                {active.credentials.kind === "github" && <span className="badge">Open</span>}
                {cloud && (
                  <button
                    aria-label={
                      active.credentials.kind === "github"
                        ? "Choose another GitHub repository"
                        : "Connect GitHub repository"
                    }
                    onClick={() => {
                      if (!active.bridge.canSignOut()) {
                        setError("Save or discard your new draft before connecting GitHub.");
                        return;
                      }
                      void connectGitHub().catch((reason) =>
                        setError(reason instanceof Error ? reason.message : String(reason)),
                      );
                    }}
                  >
                    {active.credentials.kind === "github" ? "Change" : "Connect"}
                  </button>
                )}
              </div>
            </div>
            <p className="web-account-note">
              {pending
                ? `${pending} ${pending === 1 ? "change is" : "changes are"} waiting to sync. ${pending === 1 ? "It stays" : "They stay"} in this browser after sign-out.`
                : "Everything is synced. A copy stays in this browser for offline use."}
            </p>
            {error && (
              <p role="alert" className="web-error">
                {error}
              </p>
            )}
            <footer>
              <button
                className="web-sign-out"
                onClick={() => void signOut().catch((reason) => setError(String(reason)))}
              >
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </button>
              <button className="primary" onClick={() => setAccount(false)}>
                Back to notes
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
