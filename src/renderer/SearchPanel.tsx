import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "../shared/types";
import type { WorkingTab } from "../shared/recovery";
import { textMatches } from "../shared/search";
export function SearchPanel({
  root,
  path,
  documents,
  jump,
  close,
}: {
  root: string;
  path?: string;
  documents: WorkingTab[];
  jump: (hit: SearchHit, query: string) => Promise<void>;
  close: () => void;
}) {
  const [query, setQuery] = useState(""),
    [hits, setHits] = useState<SearchHit[]>([]),
    [errors, setErrors] = useState<{ path: string; error: string }[]>([]),
    [busy, setBusy] = useState(false),
    [truncated, setTruncated] = useState(false),
    [selected, setSelected] = useState(-1);
  const id = useRef("");
  useEffect(() => {
    const request = crypto.randomUUID();
    id.current = request;
    setHits([]);
    setErrors([]);
    setSelected(-1);
    setTruncated(false);
    if (!query) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const unsubscribe = window.folio.onSearch((batch) => {
      if (batch.id !== request || batch.root !== root) return;
      setHits((h) => [...h, ...batch.hits].slice(0, 1000));
      setErrors((e) => [...e, ...batch.errors]);
      if (batch.done) {
        setBusy(false);
        setTruncated(!!batch.truncated);
      }
    });
    const timer = setTimeout(
      () =>
        void window.folio.startSearch(request, query, path, root).catch((error) => {
          if (id.current === request) {
            setBusy(false);
            setErrors([{ path: path || "Workspace", error: String(error) }]);
          }
        }),
      200,
    );
    return () => {
      clearTimeout(timer);
      unsubscribe();
      void window.folio.cancelSearch(request, root).catch(() => {});
    };
  }, [root, path, query]);
  const dirty = documents.filter(
      (doc) => doc.value !== doc.doc.content && (!path || path === doc.path),
    ),
    dirtyPaths = new Set(dirty.map((d) => d.path));
  const results: SearchHit[] = [
    ...dirty.flatMap((doc) =>
      textMatches(doc.value, query).map((match) => ({
        ...match,
        path: doc.path,
        sourceHash: `draft:${doc.id}`,
        unsaved: true,
      })),
    ),
    ...hits.filter((hit) => !dirtyPaths.has(hit.path)),
  ].slice(0, 1000);
  const go = (index: number) => {
    if (!results.length) return;
    const i = (index + results.length) % results.length;
    setSelected(i);
    void jump(results[i], query).catch((error) =>
      setErrors((e) => [...e, { path: results[i].path, error: String(error) }]),
    );
  };
  return (
    <section className="search-panel" aria-label={path ? "Find in file" : "Search workspace"}>
      <header>
        <input
          aria-label="Search file contents"
          autoFocus
          maxLength={256}
          placeholder={path ? `Find in ${path}` : "Search notes, code and PDF text"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              go(selected + (e.shiftKey ? -1 : 1));
            }
            if (e.key === "Escape") close();
          }}
        />
        <button
          aria-label="Previous match"
          disabled={!results.length}
          onClick={() => go(selected - 1)}
        >
          ↑
        </button>
        <button aria-label="Next match" disabled={!results.length} onClick={() => go(selected + 1)}>
          ↓
        </button>
        <button aria-label="Close search" onClick={close}>
          ×
        </button>
      </header>
      <p role="status">
        {busy ? "Searching…" : `${results.length} matches`}
        {truncated ? " · First 1,000 shown. Narrow your search." : ""}
        {path ? ` · ${path}` : ""}
      </p>
      <div className="search-results">
        {results.map((hit, i) => {
          const spans = textMatches(hit.snippet, query);
          let cursor = 0;
          const parts = [];
          for (const match of spans) {
            parts.push(
              hit.snippet.slice(cursor, match.from),
              <mark key={match.from}>{hit.snippet.slice(match.from, match.to)}</mark>,
            );
            cursor = match.to;
          }
          parts.push(hit.snippet.slice(cursor));
          return (
            <button
              className={selected === i ? "active" : ""}
              key={`${hit.path}:${hit.page || 0}:${hit.from}`}
              onClick={() => go(i)}
            >
              <strong>{hit.path}</strong>
              <small>
                {hit.page ? `Page ${hit.page}` : `Line ${hit.line}`}
                {hit.unsaved ? " · Unsaved" : ""}
              </small>
              <span>{parts}</span>
            </button>
          );
        })}
      </div>
      {!!errors.length && (
        <details>
          <summary>{errors.length} files could not be searched</summary>
          {errors.map((error, i) => (
            <p key={i}>
              {error.path}: {error.error}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
