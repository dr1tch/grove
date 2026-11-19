# Radix UI adoption implementation plan

> Use subagent-driven-development for independent UI families, or execute inline if subagents are unavailable. No commit, install or publishing is authorized.

**Goal:** Use Radix for every matching standard application UI control on desktop and web, keeping custom behavior only for Grove-specific features or patterns Radix does not supply.

**Architecture:** Preserve Grove CSS and business state. Thin shared styled wrappers compose Radix primitives; they do not reimplement positioning, focus, keyboard or dismissal. Keep editors, file rendering and document widgets owned by Tiptap, CodeMirror, Excalidraw and existing viewer libraries. Native buttons/text inputs stay native because Radix Primitives has no styled replacement. QuickSwitcher retains its fuzzy-search/listbox logic because Radix has no combobox/command primitive.

**Tech Stack:** React19, radix-ui1.8.1 and existing @radix-ui/react-menu2.2.1, existing CSS/Lucide. No Radix Themes or visual redesign.

**Spec:** User requires broad Radix adoption, avoiding in-house controls whenever Radix provides the equivalent. Preserve the old Grove appearance and all save/recovery/selection/fullscreen invariants established in earlier work.

## Tasks

1. Add radix-ui to root/web and shared wrappers for Dialog, Tooltip, Select, Checkbox, Slider, Collapsible and anchored Dropdown/Popover using native Radix state/focus behavior. Portal into fullscreen content and ensure nested overlays belong to the correct dialog/fullscreen layer. Retain application styling.
2. Migrate standalone dialogs and inline App dialogs, removing showModal/manual focus/Escape/backdrop code. Keep draft/save/busy/navigation guards. QuickSwitcher keeps its search semantics inside a Radix dialog. Migrate Settings sections and appearance choices to Tabs/ToggleGroup where suitable.
3. Migrate standard selects, UI checkboxes, media sliders/speed menu, collapsible application panels, shared tooltips and toolbars. Do not replace checkboxes/HTML owned by third-party editor/rendering libraries. Convert file/tab/document menus to Radix; preserve context ownership and current actions.
4. Audit remaining in-house standard controls and document justified exceptions. Verify types/unit tests/builds and real desktop/browser flows: settings/forms, select/checkbox/slider/collapsible, tooltip, menus, nested dialogs, drafts/recovery, editor formatting and fullscreen. Run focused final review and visual parity capture/comparison. Leave installed0.5.6 unchanged.

## Verification

Existing scripts remain the integration seam. Update selectors to the correct Radix roles instead of preserving obsolete native tags. Add a focused UI-primitives QA flow with keyboard navigation, focus trapping/restoration, dismissal, nested portal visibility, save/undo and no runtime console errors. Keep all fixtures synthetic and never operate normal Grove/private vault windows.

## Completed verification, 2026-11-16

208 tests pass, with10 local database cases skipped. Root and landing type checks, scoped formatting/lint checks, desktop/web/landing builds and git diff checks pass. Synthetic Electron flows pass for11 UI primitive scenarios, media slider/speed keyboard behavior, formatted/live item editing, source preservation, toolbar insertion, document sizing/zoom/fullscreen and tab/pane lifecycle. Browser fake-GitHub flows pass for editing, both Preview styles, queued saves, conflicts and phone layout. Landing checks pass at390/768/793/1440px including FAQ keyboard navigation. Controlled media slider changes refresh synchronously so rapid keyboard steps do not depend on delayed browser media events.

Final code review found no remaining actionable issues. The visual recheck at ~/parity/grove-radix-ui-2026-11-16/run2/report.md covers9 paired dark/light states with0open/0new findings. The expanded-folder chevron regression is fixed. Both Radix selector popups are visibly captured; native OS popup references cannot be captured by Electron page screenshots.

Remaining custom UI is domain-specific: the vault file picker and QuickSwitcher search results, editor/viewer document rendering, workspace/pane lifecycle and sidebar resizing. Their matching standard subcontrols use Radix. Radix Primitives provides no file picker, command/combobox, text input, ordinary action button or resizable pane primitive. The landing FAQ now uses Accordion. Installed Grove stays0.5.6; no install, commit, push or publishing was performed.
