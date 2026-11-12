import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";

export type GitErrorKind = "offline" | "auth" | "conflict" | "not-repo" | "busy" | "other";

export class GitError extends Error {
  constructor(
    public kind: GitErrorKind,
    message: string,
    public stdout = "",
    public stderr = "",
    public code: number | string | null = null,
  ) {
    super(message);
    this.name = "GitError";
  }
}

function classify(stdout: string, stderr: string): GitErrorKind {
  if (/CONFLICT/.test(`${stderr}\n${stdout}`)) return "conflict";
  if (
    /Could not resolve host|Connection refused|Failed to connect|Could not connect to server|Network is unreachable|timed out|does not appear to be a git repository/.test(
      stderr,
    )
  )
    return "offline";
  if (/Authentication failed|Permission denied \(publickey\)|could not read Username/.test(stderr))
    return "auth";
  if (/not a git repository/.test(stderr)) return "not-repo";
  if (/index\.lock/.test(stderr)) return "busy";
  return "other";
}

/** Creates the vault io lock file if needed and returns its path. */
export async function ensureLock(root: string): Promise<string> {
  const lock = join(root, ".folio/io.lock");
  await mkdir(join(root, ".folio"), { recursive: true, mode: 0o700 });
  await (
    await open(
      lock,
      constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
  ).close();
  return lock;
}

type GitOptions = { locked?: boolean; input?: string | Buffer; raw?: boolean };

/** With `raw: true`, stdout is returned as bytes (for binary blobs). */
export function runGit(
  root: string,
  args: string[],
  options: GitOptions & { raw: true },
): Promise<{ stdout: Buffer; stderr: string }>;
export function runGit(
  root: string,
  args: string[],
  options?: GitOptions & { raw?: false },
): Promise<{ stdout: string; stderr: string }>;
export async function runGit(
  root: string,
  args: string[],
  options: GitOptions = {},
): Promise<{ stdout: string | Buffer; stderr: string }> {
  let command = "git",
    argv = ["-C", root, ...args];
  if (options.locked) {
    command = "flock";
    argv = [await ensureLock(root), "git", ...argv];
  }
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
  env.GIT_HTTP_LOW_SPEED_LIMIT ??= "1000";
  env.GIT_HTTP_LOW_SPEED_TIME ??= "30";
  if (env.GIT_SSH_COMMAND === undefined && env.GIT_SSH === undefined)
    env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes -o ConnectTimeout=15";
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      argv,
      { env, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (error, out, err) => {
        const stdout = out.toString("utf8"),
          stderr = err.toString("utf8");
        if (!error) return resolve({ stdout: options.raw ? out : stdout, stderr });
        const code = (error as NodeJS.ErrnoException).code ?? null;
        reject(
          new GitError(
            classify(stdout, stderr),
            stderr.trim() || error.message,
            stdout,
            stderr,
            code,
          ),
        );
      },
    );
    // git/flock may exit before reading stdin; the exit callback reports the failure.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}
