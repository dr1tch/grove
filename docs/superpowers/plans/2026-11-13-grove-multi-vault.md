# Grove saved vaults and independent GitHub access

Approved direction: one Grove account can open its cloud vault and multiple saved GitHub repositories. Connecting repository access must not link a Supabase identity, replace the Grove session or require deleting another account. Continue with GitHub remains an account sign-in option.

## Ownership and steps

1. Add `user_vaults` with owner/repository/branch only, uniqueness per Grove user, row-level security and strict input checks. Add `apps/web/src/vaults.ts`; verify duplicates, validation and isolation against local Supabase. Cloud is implicit; removing a shortcut never removes files or browser recovery data.
2. Add `apps/web/src/github-app.ts` for authorization state, PKCE, browser-session connections and refresh; an authenticated Supabase Edge Function exchanges/refreshes codes using a server-only client secret. Callback is a separate static HTML entry to avoid Supabase consuming the GitHub App code. Fixed GitHub endpoints, exact redirect allowlist, no token logging/persistence server-side. Unit tests cover state/user/expiry/replay, provider failures and refresh serialization.
3. Integrate Account with the saved list, repository picker and safe switching. Open the target before closing the active vault; refuse draft loss and preserve both queues. Saved vaults follow the Grove account; connections are scoped to that account and browser session. Each new browser reconnects GitHub once. Keep the existing token fallback compatible; no automatic account deletion or cloud-to-repo copying.
4. Verify browser flows against local Supabase and mocked GitHub authorization/exchange, desktop regressions and full checks. Preserve the existing Account/Sync design. Run code review and visual capture/recheck for changed account UI.
5. Prepare exact GitHub App registration and Edge Function settings. Real GitHub App creation/secrets and hosted deployment are separate activation steps; do not put the secret in browser assets or chat. Do not commit, push, deploy or change hosted accounts without a current authorization.

## Limits

No migration of cloud content to GitHub, new phone implementation, quota/garbage collection work or account deletion. Local RLS and browser tests prove boundaries without private repositories. Real provider round-trip remains an activation gate until the GitHub App exists. Local tests use synthetic users only.
