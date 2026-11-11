import { useEffect, useRef, useState } from "react";
import type { Entry } from "../shared/types";
import { rankFiles } from "../shared/file-search";
import { FileIcon } from "./FileIcon";
export function QuickSwitcher({
  entries,
  recent,
  open,
  close,
}: {
  entries: Entry[];
  recent: string[];
  open: (path: string, beside: boolean) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(""),
    [index, setIndex] = useState(0);
  const results = rankFiles(query, entries, recent).slice(0, 50),
    selected = results[Math.min(index, results.length - 1)];
  useEffect(() => {
    dialog.current!.showModal();
    input.current!.focus();
  }, []);
  useEffect(() => {
    dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [index]);
  return (
    <dialog
      ref={dialog}
      className="quick-switcher"
      aria-label="Quick file switcher"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <input
            ref={input}
            role="combobox"
            aria-label="Find a file"
            aria-expanded="true"
            aria-controls="switcher-results"
            aria-activedescendant={
              selected ? `switcher-${Math.min(index, results.length - 1)}` : undefined
            }
            placeholder="Find a file…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((i) =>
                  results.length
                    ? (i + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length
                    : 0,
                );
              }
              if (event.key === "Enter" && selected) {
                event.preventDefault();
                open(selected.path, event.shiftKey);
              }
            }}
          />
          <button aria-label="Close switcher" onClick={close}>
            ×
          </button>
        </header>
        <div
          id="switcher-results"
          role="listbox"
          aria-label={query ? "Matching files" : "Recent files"}
        >
          {results.map((result, i) => {
            const fragments = [];
            let cursor = 0;
            for (const [start, end] of result.ranges) {
              fragments.push(
                result.path.slice(cursor, start),
                <mark key={start}>{result.path.slice(start, end)}</mark>,
              );
              cursor = end;
            }
            fragments.push(result.path.slice(cursor));
            return (
              <button
                role="option"
                id={`switcher-${i}`}
                aria-selected={i === Math.min(index, results.length - 1)}
                key={result.path}
                onClick={() => open(result.path, false)}
                onMouseMove={() => setIndex(i)}
              >
                <FileIcon path={result.path} />
                <span>{fragments}</span>
                <small>{result.path.split("/").slice(0, -1).join("/") || "Vault root"}</small>
              </button>
            );
          })}
          {!results.length && (
            <p className="muted">
              {query ? "No matching files." : "Open a file to start your recent list."}
            </p>
          )}
        </div>
        <footer>↑ ↓ Select · Enter Open · Shift+Enter Open beside · Esc Close</footer>
      </section>
    </dialog>
  );
}
