# Grove Accounts and Cloud Vaults Plan

**Goal:** One-click sign-in for the web (later phone) client with GitHub, Google or email/password. GitHub users keep their vault in their repository. Google and email users get a Grove cloud vault.

**Decision (2026-11-12):** Supabase provides auth, Postgres and Storage. This replaces the client plan's "no hosted Grove server" constraint for web and phone. Desktop is unchanged.

**Architecture:** `VaultSession`, the caches and the web bridge already depend on a small store surface (`head`, `list`, `read`, `readAsset`, `write`, `create`, `createBytes`, `remove`, `rename`, `mkdir`, `versions`, `dispose`, plus `root`/`device`). Name that surface `RemoteStore` and add `CloudStore` (Supabase) beside the GitHub `VaultStore`. Sync, offline queue, conflict copies and the renderer stay shared.

## Data model (Supabase)

- `vault_files(user_id, path, sha, size, kind, updated_at, deleted)`, primary key `(user_id, path)`. `sha` is the SHA-1 of the bytes, so cache keys and conflict checks work as with GitHub.
- File bytes in a private Storage bucket `vaults/<user_id>/<sha>` (content-addressed, so history is free).
- `vault_versions(user_id, path, sha, created_at)` for `versions()`.
- Row-level security: every row and object is readable and writable only where `user_id = auth.uid()`.
- Writes go through one SQL function `save_file(path, base_sha, new_sha, size)` that updates only when the current sha equals `base_sha` (or the row is absent for creates). A mismatch raises a conflict, which `CloudStore` maps to the existing `conflict` error, so conflict copies keep working unchanged.
- `head()` returns the user's latest `updated_at` change counter so polling stays cheap.

## Sign-in

- Supabase Auth providers: GitHub, Google, email/password (with email confirmation and reset).
- GitHub sign-in requests the `repo` scope and keeps the returned GitHub token in the browser, as today. Then the user picks a repository and branch. Caveat: OAuth `repo` scope covers all of the user's private repositories; pasted fine-grained tokens remain available as "Use a token instead".
- Google and email users go straight to their cloud vault.
- Tokens and sessions never enter service-worker caches, logs or the landing page origin.

## Stages

1. **Store interface and cloud schema** (about 1 day). Extract `RemoteStore`; add SQL migration, RLS policies and `CloudStore`; run the existing sync tests against both stores using local Supabase in Docker.
2. **Sign-in screen** (about half a day). Provider buttons, email form with reset, GitHub repository picker, session restore and sign-out that keeps queued edits.
3. **Project setup with the user** (about 30 minutes of their time). Create the Supabase project, Google OAuth client and GitHub OAuth app; add redirect URLs; put the public URL and anon key in the web build.
4. **Checks** (about half a day). Browser QA for each provider against local Supabase; cross-account isolation test (user A cannot read user B's files); offline queue and conflicts on a cloud vault.

## Required before public launch (from the Stage 1 security review)

- **Storage quota and cleanup:** a per-user byte quota, plus a scheduled job (service role) that deletes blobs no `vault_files` or `vault_versions` row references and caps versions per path. Until then, an account can upload unreferenced 50 MiB blobs without limit.
- **Account deletion:** delete `vaults/<uid>/` objects through the Storage API before `auth.admin.deleteUser`. Rows cascade; blobs do not.

## Not in scope yet

- Moving a vault between GitHub and the cloud.
- Desktop sign-in to cloud vaults, phone app, paid plans, storage quotas beyond Supabase defaults.
- Privacy policy and terms text, which hosting user notes requires before public launch.
