# Shared GitHub vault

Private TypeScript source workspace for browser and future native clients. It is independent of Electron and has no UI, credential persistence, telemetry or application server. Use the explicit `/store`, `/sync`, `/cache`, `/types` and `/github` exports. The desktop keeps its existing Git CLI sync.

## Online store

Construct `VaultStore({ owner, repo, branch }, token, { device })`. It exposes list, read, write, create, createBytes, rename, remove, mkdir, assetBytes, versions and head. `readAsset` returns the bytes with their actual blob SHA for immutable caching. `rootOf` identifies one repository and branch; owner and repository identity are case insensitive.

The token stays in private class state. Requests use only `https://api.github.com`, refuse redirects, omit browser credentials and disable HTTP caching. A supplied fetch transport is a trusted test/runtime dependency and must honor `redirect: "error"`. Native fetch compatibility and redirect handling must be verified on devices before the phone integrates this library. Standard Fetch, TextEncoder/TextDecoder and Base64 Web APIs are runtime requirements. Errors never include raw provider responses or credentials.

Writes send the editor's original remote blob SHA, with no automatic retry against a newer SHA. Conflicts return the remote text. A missing file is represented by a conflict document with empty hash/content; callers must preserve the local edit. New destinations never send a SHA and cannot replace existing files. Rename is an explicitly non-atomic create-then-delete operation; a failed source deletion retains the new copy and reports both paths for review. Folder moves/deletion are rejected. Empty folders use hidden `.gitkeep` entries.

Recursive tree truncation triggers complete non-recursive subtree traversal. Incomplete directories are refused rather than silently hidden. Only regular files/directories are listed; Grove metadata, Trash, recovery exports and `.gitkeep` are hidden. Reads/uploads are limited to 50 MiB. Listings use modification time 0 for unknown dates. History returns at most 30 path-specific commits, reads content at each commit SHA and skips revisions where that path is absent. It does not follow a rename back to an old path.

## Durable session

Construct `VaultSession(store, cache)`. Its cache root must equal the store root. A successful `write` means the edit was saved locally and returns a `local:` revision hash. Call `syncNow` to upload pending revisions, and subscribe with `onChange`/`onSync`. Local revision identifiers are never sent as GitHub blob SHAs. Repeated local saves retain their original remote base. Stale local writes return a conflict instead of replacing another tab's newer text.

A flush handles one snapshot of pending revisions. New text typed during an upload remains queued. The returned state stays `syncing` while newer work is pending; the UI lifecycle adapter must schedule another flush. Concurrent calls on one session share the running flush. Independent sessions/devices remain protected by GitHub SHA checks and atomic cache revisions.

Changed or remotely deleted files preserve the local content in a unique conflict-copy file without replacing the remote version. Existing conflict names are never overwritten. A lost successful response is reconciled when remote content is identical. Every failed upload or failed conflict-copy creation leaves its pending edit intact. Binary changes, rename, remove and mkdir require a connection; the pending offline queue currently covers text creation and edits.

## Cache contract

`VaultCache` owns SHA-keyed blobs, tree snapshots, current documents, asset pointers and pending revisions. The browser implementation is `apps/web/src/cache.ts`, with one IndexedDB database per repository/branch and no token storage. The future native implementation must provide the same atomic contract using SQLite.

1. `queue` preserves the oldest remote base and replaces only the newest local revision/content. Its optional expected hash compares the current local revision or cached remote document inside the same transaction.
2. `ack` removes only its exact revision. Optional `RemoteUpdate` stores the accepted document and rebases newer pending edits only when `rebase` is true and their base matches our successful upload. Conflict copies use `rebase: false`.
3. Late acknowledgements cannot roll a newer cached upload back. Conditional `putDocument` prevents an older network read from replacing text saved while it was in flight.
4. Asset pointers and bytes are committed atomically and independently of tree snapshots. Conditional `putAsset` prevents older reads from replacing a newer opened asset. `drop` invalidates cached content without deleting pending work.
5. A browser storage operation resolves only after its transaction commits with strict durability. Quota, transaction or closed-database failures are errors, never successful saves. Sign-out, cache retention/eviction and native secure credential storage belong to later client integration.

## Verification

Run `vp test --run packages/github-vault/src`, `vp run '@grove/github-vault#typecheck'`, `vp run '@grove/web#typecheck'` and `node scripts/web-cache-qa.mjs`. The browser check uses an isolated temporary Google Chrome profile, real IndexedDB transactions, a complete browser restart and a synthetic repository. It covers upload/edit races, cross-tab saves, interrupted acknowledgements, rollback, root isolation and conflict preservation. `scripts/fake-github.mjs` is a deterministic Web API fixture; `fake-github-server.mjs` is its test-only HTTP wrapper, started only through devport when needed. Never use real credentials with either fixture.

REST references: [Contents](https://docs.github.com/en/rest/repos/contents), [Git trees](https://docs.github.com/en/rest/git/trees), [Git blobs](https://docs.github.com/en/rest/git/blobs) and [Commit history](https://docs.github.com/en/rest/commits/commits). Real GitHub, protected-repository behavior and native transport still need client integration verification. No service worker was added; GitHub responses and tokens are not cached by a service worker.
