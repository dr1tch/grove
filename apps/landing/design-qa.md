# Grove landing design QA

Final result: passed. Final capture and comparison recheck found the mobile target fixed and no new visual issues.

## Sources and verification

Reference: `/home/dr1tch/Downloads/Grove-designs-2026-11-12/08-landing-page.png` at 793 × 1983 pixels. Implementation: `http://127.0.0.1:3070/grove/`. Native-width full-page comparison, state captures and manifest: `/home/dr1tch/parity/grove-landing-2026-11-12/`; final recheck: `/home/dr1tch/parity/grove-landing-2026-11-12-run2/`. The reference and live screenshot were opened together as one comparison image; the live page has a natural 3057px height at 793px width. No image scaling was used to conceal differences.

The in-app browser is unavailable, and Chrome DevTools could not launch without an X display. Isolated headless Google Chrome through Playwright supplied real browser rendering, screenshots and interaction checks. No existing user tabs or profiles were touched. Additional widths: 390, 768 and 1440 CSS pixels, density 1. Captures include FAQ keyboard focus and an alternate open question. The static source has no corresponding responsive or interactive states.

## Fidelity surfaces

1. Typography: local Geist for UI/body and Source Serif 4 for headings, including the green italic hero line. Heading hierarchy and readable wrapping are preserved. The live copy is deliberately larger than compressed reference text.
2. Layout: header, centered hero, desktop image, three promise cards, two-column sync and formats, dark upcoming-phone band, FAQ, final CTA and footer follow the reference order and container model. Mobile stacks columns and wraps navigation without horizontal overflow.
3. Color: warm ivory page, white content bands, muted promise cards, emerald actions/eyebrows and charcoal phone section. No gradients or image tint overlays were added.
4. Images and icons: exact source Grove vector, official GitHub mark, actual isolated desktop screenshot and supplied full phone Files preview. The phone image is labelled as a design preview. Lucide icons follow the existing desktop language.
5. Content: above-the-fold headline, eyebrow, description, primary/secondary action labels and account statement match the approved reference. The FAQ adds accurate recovery/history and assistant-provider details. Phone and web remain upcoming. No fake download, store, pricing, social proof or metrics were introduced.

## Intentional differences

The generated reference is a visual direction governed by the product spec. The implementation replaces the generated desktop representation with a real capture, retains exact vector geometry, shows the complete tall phone design instead of a compressed device, uses readable text/touch sizing and supplies accurate FAQ text. These choices increase natural page height. Installation instructions and Back to top are useful real links. This is a faithful implementation of the agreed structure and design language, not pixel-identical reproduction of generated text or proportions.

## Interaction and responsive checks

`scripts/landing-qa.mjs` passes at 390/768/793/1440px. Checks cover native single-open FAQs by pointer and keyboard, skip link, navigation anchors, release/source URLs, image loading and alternative text, project-subpath assets, reduced motion, one H1, no horizontal overflow, and no browser runtime or HTTP errors. The mobile header download target was increased from 36px to 44px after initial capture and is included in the final recheck.

## Build and review

Root Vite+ checks, isolated landing types, 122 regression tests, desktop/landing builds and frozen offline install pass. Code review found no blockers. Desktop packaging includes only its own output directories and excludes the landing. No installers, APT artifacts or deployments were produced for this task.
