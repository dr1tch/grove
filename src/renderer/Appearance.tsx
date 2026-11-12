import { useEffect, useState, useRef } from "react";
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
  const modal = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<"appearance" | "editor" | "sync" | "about">(
    initialSection,
  );
  const [fonts, setFonts] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.showModal();
    void window.folio
      .fonts()
      .then(setFonts)
      .catch((e) => setError(String(e)));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={modal}
      className="settings-dialog"
      aria-label="Settings"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            close();
        }
      }}
    >
      <aside className="settings-navigation">
        <h2>Settings</h2>
        <nav aria-label="Settings categories">
          {(
            [
              ["appearance", "Appearance", Palette],
              ["editor", "Editor", TextCursorInput],
              ...(root ? ([["sync", "Sync", RefreshCw]] as const) : []),
              ["about", "About Grove", Info],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={section === id ? "selected" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-brand">
          <GroveMark size={22} />
          <span>
            Grove<small>Your ideas, connected.</small>
          </span>
        </div>
      </aside>
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
            <div className="seg settings-seg">
              {(["light", "dark", "system"] as const).map((theme) => (
                <button
                  key={theme}
                  className={settings.theme === theme ? "active" : ""}
                  onClick={() => change({ ...settings, theme })}
                >
                  {theme[0].toUpperCase() + theme.slice(1)}
                </button>
              ))}
            </div>
            <label>Accent</label>
            <div className="swatches">
              {["emerald", "pine", "indigo", "plum", "graphite", "terracotta"].map((accent) => (
                <button
                  key={accent}
                  aria-label={accent}
                  title={accent}
                  className={settings.accent === accent ? "chosen" : ""}
                  style={{ background: `var(--${accent})` }}
                  onClick={() => change({ ...settings, accent })}
                >
                  {settings.accent === accent && <Check size={15} />}
                </button>
              ))}
            </div>
            <label>Document font</label>
            <div className="font-cards">
              {(["serif", "sans", "mono", "local"] as const).map((font) => (
                <button
                  key={font}
                  className={settings.font === font ? "chosen" : ""}
                  onClick={() => change({ ...settings, font })}
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
                </button>
              ))}
            </div>
            {settings.font === "local" && (
              <div className="setting-row">
                <label htmlFor="local-font">Installed font</label>
                <select
                  id="local-font"
                  value={settings.localFont || "system-ui"}
                  onChange={(e) => change({ ...settings, localFont: e.target.value })}
                >
                  <option value="system-ui">System default</option>
                  {fonts.map((font) => (
                    <option key={font} value={font}>
                      {font}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {error && <small className="danger-text">{error}</small>}
            <div className="setting-row">
              <label htmlFor="reading-width">Reading width</label>
              <select
                id="reading-width"
                value={settings.readingWidth}
                onChange={(e) => change({ ...settings, readingWidth: Number(e.target.value) })}
              >
                {[
                  [600, "Narrow · 600"],
                  [680, "Default · 680"],
                  [780, "Wide · 780"],
                  [960, "Extra wide · 960"],
                  [1200, "Spacious · 1200"],
                  [0, "Full width"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
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
    </dialog>
  );
}
