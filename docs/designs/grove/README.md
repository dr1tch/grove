# Grove design sources

The current phone and landing references are in `/home/dr1tch/Downloads/Grove-designs-2026-11-12/index.html`, with the gallery README, manifest and screenshots in that directory. The original phone export is `/home/dr1tch/Downloads/Folio — desktop knowledge app-png (2).zip`; it predates the agreed changes. The supplied landing inspiration is `/home/dr1tch/Downloads/Landing page@1x.png`. These local references are design inputs, not shipped application assets.

The exact proposed vectors are preserved in [resources/brand](../../../resources/brand): `grove-logo.svg`, `grove-logo-small.svg` and `grove-mark.svg`. They were copied unchanged from the corresponding files in `/home/dr1tch/Downloads/`. Keep the installed desktop icon in `build/icon.png` until a separate branding change is requested.

Use [the client spec](../../specs/grove-clients.md) and actual desktop behavior when generated screenshots disagree. The phone has one document at a time, no document tabs, a circular floating add button, desktop file/icon semantics, a GitHub-style Markdown toolbar and Insert from vault. New notes stay recoverable Untitled drafts until Save. Conflicts preserve separate file versions. Desktop and browser retain tabs and panes. The landing uses current Grove branding and capabilities, with unreleased phone and web features labelled as upcoming.

The gallery includes Files, PDF reading, note editing, the first-save sheet, conflicts, drawings, audio/video, the insert picker, landing and desktop toolbar states. Future implementation must use real isolated-app screenshots for product claims and verify native keyboard/media behavior on devices.
