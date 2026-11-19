# Enable GitHub repository access

The code is ready for local testing. The GitHub App has not been created, and no hosted migration, function deployment or auth changes have been made. Grove sign-in stays separate from repository access. Existing accounts do not need to be deleted or linked.

## 1. Register the app

Open [GitHub App registration](https://github.com/settings/apps/new). Use a unique name such as `Grove Vaults`. Use your Grove web URL as the homepage. For local testing, use `http://127.0.0.1:3071/grove/app/`.

Set the authorization callback to `http://127.0.0.1:3071/grove/app/github-callback.html`. Add the deployed web URL ending in `/github-callback.html` when its origin is chosen. These callbacks belong to the web app, not Supabase's `/auth/v1/callback`. Do not enable wildcard callbacks.

Keep **Expire user authorization tokens** enabled. Leave device flow disabled. Disable active webhooks. Set repository **Contents: Read and write**; Metadata read access is automatic. Leave other permissions off. Choose **Any account** if other people will install Grove. No private key or webhook secret is needed for this user-token flow. GitHub documents these settings in [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app).

## 2. Set the public browser values

Copy the app's **Client ID** and its slug from `https://github.com/apps/<slug>`. The numeric App ID is different from Client ID. Add these public values to the web build environment, alongside the existing Supabase URL, anon key and Turnstile site key:

```dotenv
VITE_GITHUB_APP_CLIENT_ID=your-public-client-id
VITE_GITHUB_APP_SLUG=your-app-slug
```

Never put the client secret in a `VITE_` variable. For local development, `apps/web/.env.local` is already ignored. Build with `bash scripts/web-build-local.sh` against local Supabase, or `pnpm --filter @grove/web build` against the selected hosted environment. Serve auth on a dedicated trusted origin: browser scripts on the same origin can access session storage and IndexedDB.

## 3. Store the server secret

Generate a client secret in the GitHub App settings. Keep it out of chat and source control. Create a private file outside the checkout, for example `~/.config/grove/github-app.env`, with permissions `600`. Enter these values using your editor:

```dotenv
GITHUB_APP_CLIENT_ID=your-public-client-id
GITHUB_APP_CLIENT_SECRET=your-server-only-secret
GROVE_WEB_URLS=http://127.0.0.1:3071/grove/app/
```

`GROVE_WEB_URLS` is a comma-separated allowlist of exact web base URLs, each ending in `/`. Add only trusted deployed URLs with matching registered callbacks. The broker accepts only their origins and derived callback URLs. It verifies the signed-in Grove user, then exchanges or refreshes credentials at fixed GitHub endpoints. It does not save or log tokens. [GitHub's refresh-token guide](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens) explains token expiry and rotation.

For local Edge Function testing, start the existing local Supabase stack with its captcha test secret, then run `npx -y supabase@2 functions serve github-app --env-file ~/.config/grove/github-app.env` through the repository's devport workflow. Do not run a second Supabase stack or stop another session's server.

## 4. Activate the hosted backend when authorized

These commands change hosted state. They are prepared here for the later activation step, and have not been run. Verify the linked project before using them. Apply pending migrations only after reviewing `npx -y supabase@2 migration list --linked`.

```sh
npx -y supabase@2 db push --linked
npx -y supabase@2 secrets set --env-file ~/.config/grove/github-app.env
npx -y supabase@2 functions deploy github-app
```

`supabase/config.toml` disables gateway JWT verification only for this function because the handler verifies the bearer token with Supabase Auth itself. Do not remove that check. The new `user_vaults` table stores only each user's repository owner, name and branch, with row-level security. Removing its rows removes shortcuts, never repository files or local pending edits. Keep the existing Supabase GitHub sign-in provider: its OAuth app is independent from this GitHub App. No identity-linking setting is required by repository access.

## 5. Install and verify

Install the GitHub App on **Only select repositories**, selecting a disposable notes repository first. Sign into Grove with email, open **Account > Add GitHub vault**, approve GitHub access, then select that repository. If the list is empty, use **Choose repositories for Grove on GitHub**, finish installation, return to Grove and choose **Refresh repositories**. An optional branch field opens a non-default branch.

Check that Account still shows the same Grove email and can switch between cloud and the repository. Add another repository or branch. Sign into the same Grove account in another browser: the saved list should appear, and that browser must connect GitHub separately. Tokens stay in the tab's browser session and disappear on sign-out or when that session ends. A new tab or browser session may require reconnecting. Removing a shortcut must leave its repository files intact. Test a real token refresh after activation; local QA simulates GitHub because the app does not exist yet.

Next action: open the registration link in step 1. Only the public Client ID and slug are safe to share in chat.
