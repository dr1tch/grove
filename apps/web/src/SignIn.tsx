import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { Separator } from "radix-ui";
import { CheckField } from "../../../src/renderer/Controls";
import {
  accounts,
  captchaSiteKey,
  githubRepositories,
  sendPasswordReset,
  setPassword,
  signInWith,
  signInWithEmail,
} from "./auth";
import type { CloudCredentials, Credentials, GitHubCredentials, GitHubRepository } from "./auth";
import mark from "../../../resources/brand/grove-mark.svg";

type View = "choose" | "token" | "reset" | "new-password";
const message = (reason: unknown, fallback: string) =>
  reason instanceof Error && reason.message ? reason.message : fallback;

export function SignIn({
  connect,
  previous,
  initialError = "",
  github,
  cloud,
  recovering = false,
  repositories,
  cancelPicker,
  installationURL,
  refreshRepositories,
}: {
  connect: (credentials: Credentials) => Promise<void>;
  previous?: Credentials;
  initialError?: string;
  /** A browser token from repository authorization: show the repository picker. */
  github?: string;
  /** The signed-in Grove account, offered as a cloud vault next to repositories. */
  cloud?: CloudCredentials;
  recovering?: boolean;
  repositories?: GitHubRepository[];
  cancelPicker?: () => void;
  installationURL?: string;
  refreshRepositories?: () => Promise<void>;
}) {
  const [view, setView] = useState<View>(
    recovering ? "new-password" : accounts ? "choose" : "token",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError),
    [notice, setNotice] = useState(""),
    [captcha, setCaptcha] = useState(""),
    [attempt, setAttempt] = useState(0);
  const run = (task: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    void task()
      .catch((reason) => setError(message(reason, fallback)))
      .finally(() => {
        setBusy(false);
        setAttempt((value) => value + 1);
      });
  };
  const status = (
    <>
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="web-notice">
          {notice}
        </p>
      )}
    </>
  );
  const check = captchaSiteKey ? <Captcha onToken={setCaptcha} reset={attempt} /> : null;
  const waiting = !!captchaSiteKey && !captcha;
  if (github)
    return (
      <Frame title="Choose your vault" lead="Pick the private repository that holds your notes.">
        <RepositoryPicker
          token={github}
          supplied={repositories}
          cloud={cloud}
          busy={busy}
          choose={(credentials) => run(() => connect(credentials), "Could not open the vault")}
        />
        {installationURL && (
          <p className="web-help">
            <a href={installationURL} target="_blank" rel="noreferrer">
              Choose repositories for Grove on GitHub
            </a>
          </p>
        )}
        {refreshRepositories && (
          <button
            className="web-link"
            disabled={busy}
            onClick={() => run(refreshRepositories, "Could not refresh repositories")}
          >
            Refresh repositories
          </button>
        )}
        {cancelPicker && (
          <button className="web-link" disabled={busy} onClick={cancelPicker}>
            Back to notes
          </button>
        )}
        {status}
      </Frame>
    );
  return (
    <Frame
      title="Your vault, in your browser."
      lead="Notes stay in their original format, synced with GitHub or Grove cloud."
    >
      {view === "choose" && (
        <>
          <div className="web-providers">
            <button
              className="primary"
              disabled={busy}
              onClick={() => run(() => signInWith("github"), "GitHub sign-in failed")}
            >
              <GitHubLogo />
              Continue with GitHub
            </button>
          </div>
          <Separator.Root className="web-auth-separator" />
          <EmailForm
            busy={busy}
            waiting={waiting}
            check={check}
            status={status}
            submit={(email, password, create) =>
              run(async () => {
                const session = await signInWithEmail(
                  email,
                  password,
                  create,
                  captcha || undefined,
                );
                // With email confirmation on, sign-up returns no session until the link is opened.
                if (!session) setNotice("Check your email to confirm your account, then sign in.");
                else await connect({ kind: "cloud", userId: session.user.id, email: email.trim() });
              }, "Could not sign in")
            }
            forgot={() => setView("reset")}
          />
          <p className="web-help">Sign in to Grove, then add GitHub repositories from Account.</p>
          <button className="web-link" disabled={busy} onClick={() => setView("token")}>
            <KeyRound size={14} aria-hidden="true" />
            Use a GitHub token instead
          </button>
        </>
      )}
      {view === "reset" && (
        <ResetForm
          busy={busy}
          waiting={waiting}
          check={check}
          status={status}
          submit={(email) =>
            run(async () => {
              await sendPasswordReset(email, captcha || undefined);
              setNotice("If an account exists for that address, a reset link is on its way.");
            }, "Could not send the reset email")
          }
          back={() => setView("choose")}
        />
      )}
      {view === "new-password" && (
        <NewPasswordForm
          busy={busy}
          status={status}
          submit={(password) =>
            run(async () => {
              await setPassword(password);
              const { data } = await accounts!.auth.getSession();
              if (!data.session) throw new Error("The reset link expired. Request a new one.");
              await connect({
                kind: "cloud",
                userId: data.session.user.id,
                email: data.session.user.email ?? "",
              });
            }, "Could not set the new password")
          }
        />
      )}
      {view === "token" && (
        <TokenForm
          previous={previous?.kind === "github" ? previous : undefined}
          busy={busy}
          status={status}
          submit={(credentials) => run(() => connect(credentials), "Could not connect")}
          back={accounts ? () => setView("choose") : undefined}
        />
      )}
    </Frame>
  );
}

function Frame({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <main className="web-sign-in">
      <section>
        <a className="web-brand" href="../">
          <img src={mark} alt="" width="45" height="45" />
          Grove
        </a>
        <h1>{title}</h1>
        <p>{lead}</p>
        {children}
      </section>
    </main>
  );
}

function EmailForm({
  busy,
  waiting,
  check,
  status,
  submit,
  forgot,
}: {
  busy: boolean;
  waiting: boolean;
  check: ReactNode;
  status: ReactNode;
  submit: (email: string, password: string, create: boolean) => void;
  forgot: () => void;
}) {
  const [create, setCreate] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPasswordValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(email.trim(), password, create);
      }}
    >
      <label>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          minLength={create ? 8 : undefined}
          autoComplete={create ? "new-password" : "current-password"}
          value={password}
          onChange={(event) => setPasswordValue(event.target.value)}
          disabled={busy}
        />
      </label>
      {check}
      {status}
      <button className="primary" type="submit" disabled={busy || waiting}>
        {busy ? "Please wait…" : create ? "Create account" : "Sign in"}
      </button>
      <button type="button" className="web-link" onClick={() => setCreate(!create)}>
        {create ? "I already have an account" : "Create an account"}
      </button>
      {!create && (
        <button type="button" className="web-link" onClick={forgot}>
          Forgot password?
        </button>
      )}
    </form>
  );
}

function ResetForm({
  busy,
  waiting,
  check,
  status,
  submit,
  back,
}: {
  busy: boolean;
  waiting: boolean;
  check: ReactNode;
  status: ReactNode;
  submit: (email: string) => void;
  back: () => void;
}) {
  const [email, setEmail] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(email.trim());
      }}
    >
      <label>
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
      </label>
      {check}
      {status}
      <button className="primary" type="submit" disabled={busy || waiting}>
        Send reset link
      </button>
      <button type="button" className="web-link" onClick={back}>
        Back to sign in
      </button>
    </form>
  );
}

function NewPasswordForm({
  busy,
  status,
  submit,
}: {
  busy: boolean;
  status: ReactNode;
  submit: (password: string) => void;
}) {
  const [password, setPasswordValue] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit(password);
      }}
    >
      <label>
        New password
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPasswordValue(event.target.value)}
          disabled={busy}
        />
      </label>
      {status}
      <button className="primary" type="submit" disabled={busy}>
        Set password
      </button>
    </form>
  );
}

function RepositoryPicker({
  token,
  supplied,
  cloud,
  busy,
  choose,
}: {
  token: string;
  supplied?: GitHubRepository[];
  cloud?: CloudCredentials;
  busy: boolean;
  choose: (credentials: Credentials) => void;
}) {
  const [repositories, setRepositories] = useState<GitHubRepository[]>(),
    [filter, setFilter] = useState(""),
    [branch, setBranch] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    (supplied ? Promise.resolve(supplied) : githubRepositories(token))
      .then((list) => live && setRepositories(list))
      .catch((reason) => live && setError(message(reason, "Could not list repositories")));
    return () => {
      live = false;
    };
  }, [token, supplied]);
  const shown = (repositories ?? []).filter((repository) =>
    `${repository.owner}/${repository.repo}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  return (
    <div className="web-repositories">
      <label>
        Find a repository
        <input
          value={filter}
          autoComplete="off"
          onChange={(event) => setFilter(event.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        Branch (optional)
        <input
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          disabled={busy}
          placeholder="Repository default"
        />
      </label>
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
      {!repositories && !error && <p role="status">Loading repositories…</p>}
      <ul aria-label="Repositories">
        {shown.slice(0, 50).map((repository) => (
          <li key={`${repository.owner}/${repository.repo}`}>
            <button
              disabled={busy}
              onClick={() =>
                choose({
                  kind: "github",
                  ref: {
                    owner: repository.owner,
                    repo: repository.repo,
                    branch: branch.trim() || repository.branch,
                  },
                  token,
                  remember: true,
                })
              }
            >
              <span>
                {repository.owner}/{repository.repo}
              </span>
              <small>{repository.private ? "Private" : "Public"}</small>
            </button>
          </li>
        ))}
      </ul>
      {repositories && !shown.length && <p className="web-help">No matching repositories.</p>}
      {cloud && (
        <button disabled={busy} onClick={() => choose(cloud)}>
          Use Grove cloud instead
        </button>
      )}
    </div>
  );
}

function TokenForm({
  previous,
  busy,
  status,
  submit,
  back,
}: {
  previous?: GitHubCredentials;
  busy: boolean;
  status: ReactNode;
  submit: (credentials: GitHubCredentials) => void;
  back?: () => void;
}) {
  const [owner, setOwner] = useState(previous?.ref.owner ?? ""),
    [repo, setRepo] = useState(previous?.ref.repo ?? ""),
    [branch, setBranch] = useState(previous?.ref.branch ?? "main"),
    [token, setToken] = useState(""),
    [remember, setRemember] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit({
          kind: "github",
          ref: { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() },
          token: token.trim(),
          remember,
        });
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
        <CheckField checked={remember} onCheckedChange={setRemember} disabled={busy} />
        Remember this browser
      </label>
      <p className="web-help">
        {remember
          ? "The token will be stored in this browser until you sign out. Use a trusted device."
          : "The token stays in this browser session. Local pending edits remain recoverable after sign-out."}
      </p>
      {status}
      <button className="primary" type="submit" disabled={busy}>
        {busy ? "Connecting…" : "Open vault"}
      </button>
      {back && (
        <button type="button" className="web-link" onClick={back}>
          Other ways to sign in
        </button>
      )}
    </form>
  );
}

// Official brand marks, as their sign-in guidelines ask for on provider buttons.
export function GitHubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
type Turnstile = {
  render(host: HTMLElement, options: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
};
let turnstile: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  return (turnstile ??= new Promise<Turnstile>((done, fail) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = () => done((window as unknown as { turnstile: Turnstile }).turnstile);
    script.onerror = () => {
      turnstile = undefined;
      fail(new Error("The security check could not load. Check your connection and retry."));
    };
    document.head.append(script);
  }));
}
// Cloudflare Turnstile; each token works once, so `reset` changes after every attempt.
function Captcha({ onToken, reset }: { onToken: (token: string) => void; reset: number }) {
  const host = useRef<HTMLDivElement>(null),
    widget = useRef<string>(undefined),
    api = useRef<Turnstile>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    loadTurnstile()
      .then((loaded) => {
        if (!live || !host.current) return;
        api.current = loaded;
        widget.current = loaded.render(host.current, {
          sitekey: captchaSiteKey,
          callback: onToken,
          "expired-callback": () => onToken(""),
          "error-callback": () => onToken(""),
        });
      })
      .catch((reason: Error) => live && setError(reason.message));
    return () => {
      live = false;
      if (widget.current) api.current?.remove(widget.current);
      onToken("");
    };
  }, [onToken]);
  useEffect(() => {
    if (!reset || !widget.current) return;
    onToken("");
    api.current?.reset(widget.current);
  }, [reset, onToken]);
  return (
    <>
      <div ref={host} className="web-captcha" />
      {error && (
        <p role="alert" className="web-error">
          {error}
        </p>
      )}
    </>
  );
}
