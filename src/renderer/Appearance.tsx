import { Tabs, ToggleGroup } from "radix-ui";
import { Dialog } from "./Dialog";
import { SelectField } from "./Controls";
import { useEffect, useState } from "react";
import { Check, Maximize, X, Palette, TextCursorInput, Info, RefreshCw } from "lucide-react";
import { SyncSettings } from "./SyncSettings";
import { GroveMark } from "./FolderIcon";
import type { Settings } from "../shared/types";
export function Appearance({
  settings,
  change,
  close,
  root = "",
  initialSection = "appearance",
  syncChanged,
}: {
  settings: Settings;
  change: (s: Settings) => void;
  close: () => void;
  root?: string;
  initialSection?: "appearance" | "editor" | "sync" | "about";
  syncChanged?: () => void;
}) {
  const [section, setSection] = useState<"appearance" | "editor" | "sync" | "about">(
    initialSection,
  );
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.folio
      .fonts()
      .then(setFonts)
      .catch((e) => setError(String(e)));
  }, []);
  return (
    <Tabs.Root
      value={section}
      onValueChange={(value) => setSection(value as typeof section)}
      orientation="vertical"
      asChild
    >
      <Dialog className="settings-dialog" label="Settings" close={close}>
        <aside className="settings-navigation">
          <h2>Settings</h2>
          <Tabs.List asChild>
            <nav aria-label="Settings categories">
              {(
                [
                  ["appearance", "Appearance", Palette],
                  ["editor", "Editor", TextCursorInput],
                  ...(root ? ([["sync", "Sync", RefreshCw]] as const) : []),
                  ["about", "About Grove", Info],
                ] as const
              ).map(([id, label, Icon]) => (
                <Tabs.Trigger value={id} key={id} className={section === id ? "selected" : ""}>
                  <Icon size={16} />
                  {label}
                </Tabs.Trigger>
              ))}
            </nav>
          </Tabs.List>
          <div className="settings-brand">
            <GroveMark size={22} />
            <span>
              Grove<small>Your ideas, connected.</small>
            </span>
          </div>
        </aside>
        <Tabs.Content key={section} value={section} asChild>
          <section className="settings-content settings">
            <header>
              <h2>
                {section === "appearance"
                  ? "Appearance"
                  : section === "editor"
                    ? "Editor"
                    : section === "sync"
                      ? "Sync"
                      : "About Grove"}
              </h2>
              <button aria-label="Close settings" onClick={close}>
                <X size={16} />
              </button>
            </header>
            {section === "appearance" && (
              <>
                <p className="settings-intro">Make room for the way you think.</p>
                <label>Theme</label>
                <ToggleGroup.Root
                  type="single"
                  value={settings.theme}
                  onValueChange={(value) => {
                    if (value)
                      change({
                        ...settings,
                        theme: value as Settings["theme"],
                      });
                  }}
                  className="seg settings-seg"
                  aria-label="Theme"
                >
                  {(["light", "dark", "system"] as const).map((theme) => (
                    <ToggleGroup.Item
                      value={theme}
                      key={theme}
                      className={settings.theme === theme ? "active" : ""}
                    >
                      {theme[0].toUpperCase() + theme.slice(1)}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
                <label>Accent</label>
                <ToggleGroup.Root
                  type="single"
                  value={settings.accent}
                  onValueChange={(value) => {
                    if (value)
                      change({
                        ...settings,
                        accent: value as Settings["accent"],
                      });
                  }}
                  className="swatches"
                  aria-label="Accent"
                >
                  {["emerald", "pine", "indigo", "plum", "graphite", "terracotta"].map((accent) => (
                    <ToggleGroup.Item
                      value={accent}
                      key={accent}
                      aria-label={accent}
                      title={accent}
                      className={settings.accent === accent ? "chosen" : ""}
                      style={{ background: `var(--${accent})` }}
                    >
                      {settings.accent === accent && <Check size={15} />}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
                <label>Document font</label>
                <ToggleGroup.Root
                  type="single"
                  value={settings.font}
                  onValueChange={(value) => {
                    if (value) change({ ...settings, font: value as Settings["font"] });
                  }}
                  className="font-cards"
                  aria-label="Document font"
                >
                  {(["serif", "sans", "mono", "local"] as const).map((font) => (
                    <ToggleGroup.Item
                      value={font}
                      key={font}
                      className={settings.font === font ? "chosen" : ""}
                    >
                      <span
                        style={{
                          fontFamily:
                            font === "serif"
                              ? "Source Serif 4"
                              : font === "mono"
                                ? "var(--mono)"
                                : font === "local"
                                  ? settings.localFont
                                  : "Geist",
                        }}
                      >
                        Aa
                      </span>
                      {font[0].toUpperCase() + font.slice(1)}
                    </ToggleGroup.Item>
                  ))}
                </ToggleGroup.Root>
                {settings.font === "local" && (
                  <div className="setting-row">
                    <label htmlFor="local-font">Installed font</label>
                    <SelectField
                      id="local-font"
                      value={settings.localFont || "system-ui"}
                      onValueChange={(localFont) => change({ ...settings, localFont })}
                      options={[
                        { value: "system-ui", label: "System default" },
                        ...fonts.map((font) => ({ value: font, label: font })),
                      ]}
                    />
                  </div>
                )}
                {error && <small className="danger-text">{error}</small>}
                <div className="setting-row">
                  <label htmlFor="reading-width">Reading width</label>
                  <SelectField
                    id="reading-width"
                    value={String(settings.readingWidth)}
                    onValueChange={(value) => change({ ...settings, readingWidth: Number(value) })}
                    options={[
                      [600, "Narrow · 600"],
                      [680, "Comfortable · 680"],
                      [780, "Wide · 780"],
                      [960, "Extra wide · 960"],
                      [1200, "Spacious · 1200"],
                      [0, "Full width (default)"],
                    ].map(([value, label]) => ({
                      value: String(value),
                      label,
                    }))}
                  />
                </div>
                <button
                  className="fullscreen-setting"
                  onClick={() => void window.folio.window("fullscreen")}
                >
                  <Maximize size={15} /> Toggle full screen <kbd>F11</kbd>
                </button>
              </>
            )}
            {section === "editor" && (
              <>
                <p className="settings-intro">A comfortable space to write.</p>{" "}
                <div className="setting-row">
                  <label htmlFor="font-size">Editor font size</label>
                  <input
                    id="font-size"
                    type="number"
                    min={10}
                    max={28}
                    value={settings.fontSize}
                    onChange={(e) =>
                      change({
                        ...settings,
                        fontSize: Math.max(10, Math.min(28, Number(e.target.value) || 14)),
                      })
                    }
                  />
                </div>
                <div className="settings-detail">
                  <strong>Source font</strong>
                  <span>JetBrains Mono Nerd Font</span>
                </div>
                <p className="settings-help">
                  Source files keep their syntax colours. The document font applies to the reading
                  preview.
                </p>
              </>
            )}
            {section === "sync" && root && <SyncSettings root={root} changed={syncChanged} />}
            {section === "about" && (
              <div className="about-grove">
                <GroveMark size={52} />
                <h3>Grove</h3>
                <p>A home for your notes, drawings and ideas.</p>
                <span className="badge">Version 0.4.0</span>
                <p className="settings-help">Local files. No account required. Yours to keep.</p>
              </div>
            )}
          </section>
        </Tabs.Content>
      </Dialog>
    </Tabs.Root>
  );
}
