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
import { AccountDialog } from "./AccountDialog";
import { forgetVault, savedVaults, saveVault } from "./vaults";
import type { SavedVault } from "./vaults";
import type { GitHubRepository } from "./auth";
import type { RepoRef } from "@grove/github-vault/types";
import {
  accounts,
  cloudCredentials,
  connectGitHub,
  githubCallback,
  githubAccess,
  returnedError,
  forgetCredentials,
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
    [recovering, setRecovering] = useState(resettingPassword),
    [vaults, setVaults] = useState<SavedVault[]>(),
    [busy, setBusy] = useState(false),
    [repositories, setRepositories] = useState<GitHubRepository[]>();
  const picker = useRef<{ userId: string; connectionId: string } | undefined>(undefined);
  const activating = useRef(false);
  const previous = useRef(storedCredentials());
  const mounted = useRef(true);
  const live = useRef(active);
  live.current = active;
  useEffect(() => {
    if (!accounts) return;
    let owner: string | null | undefined;
    const { data } = accounts.auth.onAuthStateChange((_event, session) => {
      const next = session?.user.id ?? null;
      if (owner !== undefined && next !== owner) {
        const current = live.current;
        current?.bridge.dispose();
        void current?.vault.cache.close().catch(() => {});
        live.current = undefined;
        setActive(undefined);
        if (owner) githubAccess?.clear(owner);
        forgetCredentials();
        // Reload retires in-flight vault opens; pagehide preserves account-scoped drafts.
        location.reload();
      }
      owner = next;
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const loadVaults = async (userId = cloud?.userId) => {
    if (!accounts || !userId) return;
    setVaults(await savedVaults(accounts, userId));
  };
  const activate = async (credentials: Credentials, resume = false) => {
    if (activating.current) throw new Error("Another vault is opening. Please wait.");
    const old = live.current;
    if (old && !old.bridge.canSignOut())
      throw new Error("Save or discard your new draft before switching vaults.");
    activating.current = true;
    setBusy(true);
    let candidate: Awaited<ReturnType<typeof openVault>> | undefined;
    try {
      if (credentials.kind === "github" && picker.current)
        credentials = {
          ...credentials,
          connectionId: picker.current.connectionId,
          accountId: picker.current.userId,
          remember: false,
        };
      candidate = await openVault(credentials, resume);
      if (!mounted.current) {
        candidate.session.dispose();
        await candidate.cache.close();
        return;
      }
      if (!resume) rememberCredentials(credentials);
      // Keep the old vault alive until the target opens successfully and credentials persist.
      old?.bridge.dispose();
      await old?.vault.cache.close().catch(() => {});
      const bridge = createWebBridge(candidate.session);
      const next = { credentials, vault: candidate, bridge };
      window.folio = bridge;
      live.current = next;
      setActive(next);
      candidate = undefined;
      setGithub(undefined);
      setRepositories(undefined);
      picker.current = undefined;
      setRecovering(false);
      setError("");
      setAccount(false);
      if (credentials.kind === "cloud") setCloud(credentials);
      bridge.start();
      if (credentials.kind === "github" && accounts) {
        const user = (await accounts.auth.getSession()).data.session?.user;
        if (user) {
          try {
            await saveVault(accounts, user.id, credentials.ref);
            await loadVaults(user.id);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Could not save vault shortcut");
            setAccount(true);
          }
        }
      }
    } catch (reason) {
      candidate?.session.dispose();
      await candidate?.cache.close().catch(() => {});
      throw reason;
    } finally {
      activating.current = false;
      setBusy(false);
    }
  };
  const showRepositories = async (userId: string, connectionId: string) => {
    if (!githubAccess) throw new Error("Connect GitHub again on this browser.");
    setBusy(true);
    try {
      const token = await githubAccess.token(userId, connectionId);
      const list = await githubAccess.repositories(userId, connectionId);
      picker.current = { userId, connectionId };
      setRepositories(list);
      setGithub(token);
      setAccount(false);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (resettingPassword) return;
        // Waits for Supabase to finish an OAuth or email-link redirect, if one is in the URL.
        const session = accounts ? (await accounts.auth.getSession()).data.session : null;
        if (cancelled) return;
        const stored = previous.current;
        let connectionError = "";
        if (session) {
          setCloud(cloudCredentials(session));
          void loadVaults(session.user.id).catch(() => {});
        }
        if (githubCallback) {
          try {
            if (!githubAccess || !session)
              throw new Error("Sign in to Grove before connecting GitHub.");
            const result = await githubAccess.finish(new URL(location.href));
            await showRepositories(result.userId, result.connection.id);
            return;
          } catch (reason) {
            connectionError = reason instanceof Error ? reason.message : "GitHub connection failed";
          } finally {
            history.replaceState(null, "", import.meta.env.BASE_URL);
          }
        }
        if (
          stored?.kind === "github" &&
          stored.accountId &&
          stored.accountId !== session?.user.id
        ) {
          forgetCredentials();
          if (session) await activate(cloudCredentials(session));
        } else if (stored?.kind === "cloud" && session && session.user.id !== stored.userId)
          await activate(cloudCredentials(session));
        else if (stored?.kind === "cloud" && !session) {
          forgetCredentials();
        } else if (stored) {
          try {
            await activate(stored, true);
          } catch (reason) {
            if (!connectionError || !session) throw reason;
            await activate(cloudCredentials(session));
          }
        } else if (session) await activate(cloudCredentials(session));
        if (connectionError || returnedError) {
          setError(connectionError || returnedError);
          setAccount(Boolean(live.current));
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
  const perform = async (task: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open that vault");
      setAccount(true);
    } finally {
      setBusy(false);
    }
  };
  const openSaved = async (ref: RepoRef | "cloud") => {
    if (ref === "cloud") {
      if (cloud) await activate(cloud);
      return;
    }
    if (!cloud || !githubAccess)
      throw new Error("Connect GitHub on this browser before opening that saved vault.");
    const candidates = githubAccess.connections(cloud.userId);
    if (!candidates.length) {
      // Connecting leaves the page; an unsaved new note would only have the browser's prompt.
      if (live.current && !live.current.bridge.canSignOut())
        throw new Error("Save or discard your new draft before connecting GitHub.");
      await connectGitHub();
      return;
    }
    let failure: unknown;
    for (const connection of candidates) {
      try {
        await activate({
          kind: "github",
          ref,
          token: "app",
          remember: false,
          accountId: cloud.userId,
          connectionId: connection.id,
        });
        return;
      } catch (reason) {
        failure = reason;
      }
    }
    throw failure ?? new Error("Connect a GitHub account with access to this repository.");
  };
  const signOut = async () => {
    if (!active) return;
    if (!active.bridge.canSignOut()) {
      setError("Save or discard your new draft before signing out.");
      return;
    }
    forgetCredentials();
    if (cloud) githubAccess?.clear(cloud.userId);
    await signOutAccount();
    previous.current =
      active.credentials.kind === "github" ? { ...active.credentials, token: "" } : undefined;
    setCloud(undefined);
    setVaults(undefined);
    setRepositories(undefined);
    setGithub(undefined);
    picker.current = undefined;
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
  if (!active || github)
    return (
      <SignIn
        previous={previous.current}
        initialError={error}
        github={github}
        cloud={cloud}
        recovering={recovering}
        repositories={repositories}
        installationURL={
          githubAccess
            ? `https://github.com/apps/${githubAccess.slug}/installations/new`
            : undefined
        }
        refreshRepositories={
          picker.current
            ? async () => {
                const choice = picker.current!;
                await showRepositories(choice.userId, choice.connectionId);
              }
            : undefined
        }
        cancelPicker={
          active
            ? () => {
                setGithub(undefined);
                setRepositories(undefined);
                picker.current = undefined;
              }
            : undefined
        }
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
          key={active.vault.store.root}
          account={
            <button
              className="web-account-button"
              aria-label="Repository account"
              onClick={() => {
                setAccount(true);
                setError("");
                void loadVaults().catch((reason) => setError(String(reason)));
                void active.vault.cache.pending().then((edits) => setPending(edits.length));
              }}
            >
              Account
            </button>
          }
        />
      </Suspense>
      {account && (
        <AccountDialog
          active={active.credentials}
          cloud={cloud}
          vaults={vaults}
          pending={pending}
          busy={busy}
          error={error}
          close={() => setAccount(false)}
          connect={() =>
            void perform(async () => {
              if (!active.bridge.canSignOut())
                throw new Error("Save or discard your new draft before connecting GitHub.");
              await connectGitHub();
            })
          }
          open={(ref) => void perform(() => openSaved(ref))}
          forget={(id) =>
            void perform(async () => {
              if (!cloud || !accounts) return;
              await forgetVault(accounts, cloud.userId, id);
              await loadVaults();
            })
          }
          reload={() => void perform(() => loadVaults())}
          signOut={() => void perform(signOut)}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Root />);
if ("serviceWorker" in navigator)
  void navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .catch(() => {});
