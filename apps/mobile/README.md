# Grove phone app

Expo SDK58 and React Native provide the phone shell. The app opens one document at a time and shares vault sync and Markdown rules with desktop/web. This is a development implementation, not a signed store release.

## Run and check

1. Install workspace dependencies with `pnpm install` from the repository root.
2. Build the bundled offline editor with `pnpm --filter @grove/mobile editor`.
3. Run the app through the shared server registry: from this directory, `~/.claude/scripts/devport run mobile -- pnpm exec expo start --port '{port}'`. An SDK58-compatible development client or Expo Go is required on a device.
4. Run `pnpm --filter @grove/mobile typecheck` and `pnpm --filter @grove/mobile build` to check types and export Android/iOS/browser bundles. Exporting JavaScript does not build or sign an Android/iOS application.
5. For the static phone preview, serve `out/mobile` through devport, then run `node scripts/mobile-qa.mjs` from the repository root. Run `node apps/mobile/scripts/editor-qa.mjs` for editor isolation and history checks. Root `vp test` includes mobile storage, credential, bridge and draft tests.

Use the explicitly labelled sample vault for local checks. Its files and edits stay on this device. It never connects to a personal repository. Browser preview credentials stay in memory and are intentionally forgotten on reload; cached files and recovery drafts persist separately in IndexedDB. Native credentials use SecureStore, while cache and recovery data use SQLite.

## Account setup

Optional account support uses `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. These are public configuration, never client secrets. Put local values in ignored `.env.local`. GitHub account sign-in uses the system browser with PKCE and needs the precise `grove://auth/callback` redirect allowlisted in Supabase. Account sign-in and GitHub repository permissions are separate. The repository token form requires a fine-grained token with Contents read/write for the selected repository. Tokens never enter the editor surface.

Use `.env.example` as the configuration template. Native OAuth needs a development build with the Grove URL scheme; Expo Go is suitable for trying the editor/sample, not for proving the final custom-scheme login. Account controls are hidden with a clear setup message when Supabase is not configured.

Password recovery opens `EXPO_PUBLIC_PASSWORD_RESET_URL`, an HTTPS Grove account page. Request the reset there and finish it in the same browser so its PKCE verifier stays available. The phone does not send a recovery email that would redirect to an incompatible browser session. Set `EXPO_PUBLIC_CAPTCHA_URL` to the web build's hosted `mobile-captcha.html` page. Email/password and account creation require its verified token, reset after every attempt. The CAPTCHA WebView receives no account credentials or notes and stays separate from the isolated editor. No hosted auth settings are changed by these sources. See [account deployment](../../docs/phone-account-deployment.md) for the combined website/APT artifact and exact redirect setup.

## Current scope and delivery gates

Files, Recent, filename search, a floating New note button, safe first-save/leave sheets, Markdown source editing, sanitized reading, Mermaid, formatting/history, existing references, draft recovery, conflict copies and durable offline queues are implemented. Standard native controls use React Native because Radix Primitives targets the DOM.

PDF, image, audio/video, Office and drawing viewers are not implemented on the phone yet. Those files remain listed and show an explicit unavailable message. Images embedded in Markdown show a placeholder; links display safely without opening arbitrary navigation. The document surface has a 2 MiB text limit. No remote scripts or user executable HTML are loaded.

A local Android APK was built and installed on a Samsung Galaxy A54 running Android16 on 2026-11-17. The first tested version0.1.0 was arm64 and signed with the generated local debug key. It includes the JavaScript, editor and fonts and does not require Metro. It is a test installation, not a store release. Native sample-vault checks pass for typing with the Samsung keyboard, visible formatting toolbar, Markdown formatting/readback, first save, saved-note persistence after force-stop, and unsaved-edit recovery after force-stop. Current app logs show no fatal crash in these checks. Android keyboard avoidance was corrected after the first device pass. The account-configured version0.1.1/build2 APK at `release/grove.apk` was subsequently installed with the same signing key; hosted account activation remains pending. No iOS host is available. Rotation, long-document caret/IME behavior, native SecureStore with real credentials and provider login/CAPTCHA remain unchecked. Store signing/submission remain separate gates.

## Local Android APK

Account-configured version0.1.1/build2 was installed successfully on the authorized Galaxy A54 on 2026-11-17 at14:18, preserving existing app data. Hosted web pages and account redirects still require activation before native account sign-in can be verified.

The SDK is installed at `~/Android/Sdk`. This machine has a full Java17 JDK at `/snap/androidsdk/current/usr/lib/jvm/java-17-openjdk-amd64`. Set `JAVA_HOME`, add its `bin` to `PATH`, and set `ANDROID_HOME` for build commands. The user accepted the Android SDK license before installation.

1. Run `pnpm --filter @grove/mobile editor` and `pnpm --filter @grove/mobile exec expo prebuild --platform android --no-install` from the repository root. Generated native directories are ignored.
2. From `apps/mobile/android`, run `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=4` for the connected arm64 phone.
3. Verify `app/build/outputs/apk/release/app-release.apk` with the SDK's `apksigner verify`, then copy it to `release/grove.apk` at the repository root.
4. Install with `adb -s <authorized-device> install -r release/grove.apk`. Use only the sample vault for automated checks. Keep the generated signing key for compatible local updates; store distribution needs a separately managed release key.
