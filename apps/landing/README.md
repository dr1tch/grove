# Grove landing page

Static React/Vite+ workspace built from the agreed Grove landing reference. Run workspace commands from the repository root: `vp run '@grove/landing#build'` and `vp run '@grove/landing#typecheck'`. The build is `out/landing`; its public base is `/grove/`. Keep Vite+ lint/format rules in the root config.

Design: `/home/dr1tch/Downloads/Grove-designs-2026-11-12/08-landing-page.png`, governed by `docs/specs/grove-clients.md`. Fonts are local Geist and Source Serif 4. The Grove vector is imported unchanged from `resources/brand/grove-mark.svg`. `src/assets/desktop.png` is the real isolated desktop capture from `docs/screenshot-light.png`. `phone-preview.png` is the supplied `01-phone-files.png` design, explicitly labelled as upcoming. `github.png` is the official mark from `https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png`.

Section links and native FAQ disclosures work without an application service. Download links go to the latest GitHub release; installation instructions link to the repository README. There is no auth collection, telemetry, client vault access or remote font loading. Publishing and preservation of the existing signed APT site are separate delivery work.

The responsive layout keeps the reference section order, colors and typography. The full phone preview, legible text, touch targets and accurate FAQ make the page taller than the compressed generated reference. Never substitute the generated desktop screenshot for an actual app capture or remove the upcoming labels until those clients ship.
