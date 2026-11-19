# Activate Grove phone accounts

## Current publication status, 2026-11-19

The combined website is live at https://dr1tch.github.io/grove/, including /grove/app/ and /grove/app/mobile-captcha.html. The original APT signing key, signatures and package-index checksums verify. Main CI and Pages publication pass. Hosted production site URL and web/native callbacks are activated, with unrelated auth settings preserved. The instructions below are retained for repeat deployments.

Email verification still needs dr1tch.github.io added to the existing Cloudflare Turnstile widget's Hostname Management. Live widget testing reports110200 (domain not authorized). CAPTCHA protection remains enabled. Native account sign-in is not yet verified; the user will test the phone after updating that hostname.

The user explicitly deferred this Cloudflare step on2026-11-19. Resume it only when requested.

The account-enabled phone build is prepared for the existing Grove Supabase project, qsnnexnjlxurmctljokh. It uses the same public URL and anon key as apps/web/.env.local. No client secret, service-role key or GitHub OAuth secret belongs in either client. The account-configured phone version0.1.1/build2 is installed. Account sign-in remains pending until the HTTPS pages and hosted redirects are activated and verified.

## Prepared behavior

GitHub sign-in uses the system browser, PKCE and the exact grove://auth/callback URI. Email/password and account creation wait for a CAPTCHA token and reset it after every attempt. The separate verification WebView receives no credentials, notes or account sessions. Its hosted page uses the existing Turnstile site key, validates attempts and supports expiry/error retry. The note editor keeps its network isolation. Missing verification keeps protected email actions disabled.

Cloud storage now uploads ArrayBuffer bodies and reads downloaded blobs through Response.arrayBuffer, because React Native's Blob cannot be constructed from typed arrays and has no Blob.arrayBuffer method. Existing hash, size, authorization and conflict checks remain in CloudStore.

## Publication steps

1. Review the prepared .github/workflows/apt.yml changes. The one existing Pages job now builds landing and web into the same site as the signed APT repository. Do not deploy the web app alone to this Pages site: that would remove APT metadata and packages. Supply repository variables VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_TURNSTILE_SITE_KEY from the existing web public settings. The job fails before deployment if any are missing. These three values are public build configuration.
2. Once the branch is reviewed and publication is authorized, use the existing APT repository workflow to publish the combined site. Local review artifact: release/grove-site.tar.gz. It preserves the current signed APT snapshot and adds landing at /grove/, web at /grove/app/ and verification at /grove/app/mobile-captcha.html. Future CI builds/signs the latest release's APT package as before.
3. Verify https://dr1tch.github.io/grove/app/ and https://dr1tch.github.io/grove/app/mobile-captcha.html?attempt=0&theme=light load, with real Turnstile verification. Confirm dr1tch.github.io is allowed by the existing Turnstile widget. CAPTCHA protection stays enabled.
4. Review the minimal prepared hosted configuration with `npx -y supabase@2 config diff --workdir qa-artifacts/hosted-activation --project-ref qsnnexnjlxurmctljokh`. It declares only the production site URL and redirect list, retaining existing local redirects and adding the production web path plus grove://auth/callback. The read-only diff must show only these two declared updates. Apply that exact configuration after activation is authorized. Do not push the full local Supabase config: it also differs in unrelated pooler/provider settings. Keep existing provider secrets, CAPTCHA, mail and MFA settings intact.
5. Version0.1.1/build2 from release/grove.apk is already installed on the authorized phone. After the hosting checks, open Grove. Complete one GitHub sign-in and one email/password sign-in, then test native SecureStore restore and a separate cloud vault. Real GitHub authorization and any human challenge require the user. Native desktop currently syncs through Git, so cloud parity is tested with the desktop web renderer; a native-desktop round trip needs a separately authorized GitHub test repository.

## Validation and remaining limits

All250tests pass against local Supabase, with no skips. Focused CAPTCHA tests cover exact URL/origin/current-document checks, Android callbacks without frame metadata, stale attempts, malformed messages and expiry. Browser integration uses a real local Supabase account and cloud files with a simulated CAPTCHA widget plus the provider's local test token. It covers failed sign-in/retry, account creation, two-client saves, offline replay and concurrent edits preserving both versions. Mobile/web/shared-store types, scoped lint, production builds and code review pass. This does not prove a real hosted challenge or native credential persistence.

The combined site was checked locally and live at its landing, web, verification and GitHub callback routes. Live APT signatures, original signing key and signed package-index checksums verify. The local website archive is refreshed from the successful Pages artifact; current local artifact hashes are recorded in release/SHA256SUMS. The APK signature verifies and matches installed0.1.0 for compatible updates; embedded configuration points to the hosted Grove service, with no QA endpoints.

The three public repository variables are configured, and the additive vault-shortcuts migration plus per-user mutation-lock migration are applied to hosted Grove. Web publication and auth redirect activation are complete; Cloudflare hostname authorization remains pending. No personal account, repository or notes are used for QA. Signed store distribution, iOS, phone attachment viewers and real native account/sync checks remain separate gates.
