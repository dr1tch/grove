import { useEffect, useMemo, useState } from "react";
import type { ThemedToken } from "shiki";
import { languageOf } from "../shared/files";
import { CopyButton } from "./CopyButton";
import { parseCsv } from "../shared/csv";
import "./text-preview.css";

const parsers: Record<string, string> = {
  javascript: "babel",
  jsx: "babel",
  typescript: "typescript",
  tsx: "typescript",
  vue: "vue",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
};

async function formatCode(value: string, language: string): Promise<string> {
  if (!parsers[language]) return value;
  const [prettier, babel, estree, typescript, postcss, html] = await Promise.all([
    import("prettier/standalone"),
    import("prettier/plugins/babel"),
    import("prettier/plugins/estree"),
    import("prettier/plugins/typescript"),
    import("prettier/plugins/postcss"),
    import("prettier/plugins/html"),
  ]);
  return prettier.format(value, {
    parser: parsers[language],
    plugins: [babel, estree, typescript, postcss, html],
  });
}

type Rendered = {
  path: string;
  value: string;
  dark: boolean;
  source: boolean;
  code: string;
  tokens?: ThemedToken[][];
  label: string;
};

export function TextPreview({ path, value, dark }: { path: string; value: string; dark: boolean }) {
  const language = languageOf(path);
  const [source, setSource] = useState(false);
  const [rendered, setRendered] = useState<Rendered>();
  const table = useMemo(() => {
    if (!/\.(csv|tsv)$/i.test(path)) return null;
    try {
      return {
        rows: parseCsv(value, /\.tsv$/i.test(path) ? "\t" : ","),
        error: false,
      };
    } catch {
      return { rows: [], error: true };
    }
  }, [path, value]);

  useEffect(() => {
    if (table && !table.error && !source) return;
    let cancelled = false;
    async function render() {
      let code = value;
      let label = source ? "Original source" : "Source";
      if (table?.error) label = "Invalid table quoting. Showing original source.";
      else if (!source && parsers[language]) {
        try {
          code = await formatCode(value, language);
          label = "Formatted preview";
        } catch {
          label = "Could not format. Showing original source.";
        }
      }
      let tokens: ThemedToken[][] | undefined;
      try {
        const shiki = await import("shiki");
        const lang = Object.hasOwn(shiki.bundledLanguages, language)
          ? (language as keyof typeof shiki.bundledLanguages)
          : "text";
        tokens = (
          await shiki.codeToTokens(code, {
            lang,
            theme: dark ? "github-dark" : "github-light",
          })
        ).tokens;
      } catch {
        label += " Syntax highlighting unavailable.";
      }
      if (!cancelled) setRendered({ path, value, dark, source, code, tokens, label });
    }
    void render();
    return () => {
      cancelled = true;
    };
  }, [path, value, dark, source, language, table]);

  // Keep previous files and asynchronous formatting results out of the current preview.
  const current =
    rendered?.path === path &&
    rendered.value === value &&
    rendered.dark === dark &&
    rendered.source === source
      ? rendered
      : undefined;
  const showTable = table && !table.error && !source;
  const lines =
    current?.tokens ?? (current?.code ?? value).split(/\r\n|\n|\r/).map((content) => [{ content }]);
  return (
    <section className="text-preview" aria-label="File preview">
      <header className="text-preview-toolbar">
        <span>
          {showTable
            ? `${/\.tsv$/i.test(path) ? "TSV" : "CSV"} table · ${table.rows.length} rows`
            : language}
        </span>
        <span role="status">{showTable ? "" : (current?.label ?? "Preparing preview…")}</span>
        <button type="button" aria-pressed={source} onClick={() => setSource(!source)}>
          {source ? "Preview" : "Source"}
        </button>
        <CopyButton text={source ? value : (current?.code ?? value)} />
      </header>
      <div
        className="text-preview-scroll"
        tabIndex={0}
        aria-label={showTable ? "Table contents" : "Code contents"}
      >
        {showTable ? (
          table.rows.length ? (
            <table className="text-preview-table">
              <caption>All records shown as data, including the first row.</caption>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-preview-empty">Empty table</p>
          )
        ) : (
          <pre className="text-preview-code">
            <code>
              {lines.map((line, i) => (
                <span className="text-preview-line" key={i}>
                  <span className="text-preview-number" aria-hidden="true">
                    {i + 1}
                  </span>
                  <span>
                    {line.map((token, j) => (
                      <span
                        key={j}
                        style={{
                          color:
                            "color" in token && typeof token.color === "string"
                              ? token.color
                              : undefined,
                        }}
                      >
                        {token.content}
                      </span>
                    ))}
                    {i < lines.length - 1 ? "\n" : ""}
                  </span>
                </span>
              ))}
            </code>
          </pre>
        )}
      </div>
    </section>
  );
}
