import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Document, Entry } from "../shared/types";
import { mermaidBlocks, vaultReference } from "../shared/vault-insert";
import { rankFiles } from "../shared/file-search";
import { FileIcon } from "./FileIcon";

const embeddable = new Set(["image", "pdf", "drawing", "audio", "video"]);
export function VaultInsertDialog({
  root,
  insert,
  close,
}: {
  root: string;
  insert: (content: string) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [selected, setSelected] = useState<Entry>();
  const [source, setSource] = useState<Document>();
  const [blocks, setBlocks] = useState<ReturnType<typeof mermaidBlocks>>([]);
  const [block, setBlock] = useState(0);
  const [mode, setMode] = useState("embed");
  useEffect(() => {
    dialog.current!.showModal();
    mounted.current = true;
    void window.folio
      .list()
      .then((vault) => {
        if (!mounted.current) return;
        if (vault?.root !== root) throw new Error("The vault changed. Reopen Insert from vault.");
        setEntries(
          vault.entries.filter((entry) => embeddable.has(entry.kind) || entry.kind === "markdown"),
        );
      })
      .catch((reason) => {
        if (mounted.current) setError(String(reason));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, [root]);
  useEffect(() => {
    let live = true;
    setError("");
    setSource(undefined);
    setBlocks([]);
    setBlock(0);
    if (!selected || selected.kind !== "markdown") {
      setBusy(false);
      setMode("embed");
      return;
    }
    setBusy(true);
    void window.folio
      .read(selected.path)
      .then((document) => {
        if (!live) return;
        const found = mermaidBlocks(document.content);
        setSource(document);
        setBlocks(found);
        setMode(found.length ? "source" : "link");
      })
      .catch((reason) => {
        if (live) setError(String(reason));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [selected?.path]);
  const available = entries.filter(
    (entry) =>
      filter === "All" ||
      (filter === "Media" && ["image", "audio", "video", "pdf"].includes(entry.kind)) ||
      (filter === "Drawings" && entry.kind === "drawing") ||
      (filter === "Mermaid" && entry.kind === "markdown"),
  );
  const byPath = new Map(available.map((entry) => [entry.path, entry]));
  const matches = query.trim()
    ? rankFiles(query, available, []).map((result) => byPath.get(result.path)!)
    : available.sort((a, b) => a.path.localeCompare(b.path));
  const apply = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      await window.folio.inspect(selected.path);
      if (mode === "source") {
        const latest = await window.folio.read(selected.path);
        if (!mounted.current) return;
        if (latest.hash !== source?.hash) {
          setSource(latest);
          setBlocks(mermaidBlocks(latest.content));
          setBlock(0);
          throw new Error("The source note changed. Review its blocks before inserting.");
        }
      }
      if (mounted.current)
        insert(
          mode === "source"
            ? blocks[block].content
            : vaultReference(selected.path, mode === "embed" && embeddable.has(selected.kind)),
        );
    } catch (reason) {
      if (mounted.current) setError(String(reason));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="vault-insert-dialog"
      aria-label="Insert from vault"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <header>
        <h2>Insert from vault</h2>
        <button type="button" aria-label="Close insert dialog" onClick={close}>
          <X />
        </button>
      </header>
      <input
        autoFocus
        aria-label="Search vault files"
        placeholder="Search vault files…"
        value={query}
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="insert-filters" role="group" aria-label="Content type">
        {["All", "Media", "Drawings", "Mermaid"].map((name) => (
          <button
            type="button"
            disabled={busy}
            aria-pressed={filter === name}
            key={name}
            onClick={() => {
              setFilter(name);
              setSelected(undefined);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="settings-help">
        Choose a file to embed or link, or a note to reuse its saved Mermaid diagrams and charts.
      </p>
      <div className="insert-results" aria-label="Vault files">
        {matches.slice(0, 100).map((entry) => (
          <button
            type="button"
            disabled={busy}
            key={entry.path}
            aria-pressed={selected?.path === entry.path}
            onClick={() => setSelected(entry)}
          >
            <FileIcon path={entry.path} />
            <span>{entry.path}</span>
          </button>
        ))}
        {!matches.length && (
          <p className="muted">{loading ? "Loading vault…" : "No matching files."}</p>
        )}
        {matches.length > 100 && (
          <p className="settings-help">
            Showing 100 of {matches.length} files. Refine your search.
          </p>
        )}
      </div>
      {selected && (
        <section className="insert-selection">
          <strong>{selected.path}</strong>
          {blocks.length > 0 && (
            <label>
              Mermaid block
              <select
                aria-label="Mermaid block"
                value={block}
                disabled={busy}
                onChange={(event) => setBlock(Number(event.target.value))}
              >
                {blocks.map((item, index) => (
                  <option key={index} value={index}>
                    {index + 1}. {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.kind === "markdown" && !busy && !blocks.length && (
            <p className="settings-help">No Mermaid blocks in this note. You can insert a link.</p>
          )}
          <label>
            Insert as
            <select
              aria-label="Insert as"
              value={mode}
              disabled={busy}
              onChange={(event) => setMode(event.target.value)}
            >
              {embeddable.has(selected.kind) && <option value="embed">Embed</option>}
              {blocks.length > 0 && <option value="source">Editable Mermaid source</option>}
              <option value="link">Link</option>
            </select>
          </label>
          {mode === "source" && blocks[block] && <pre>{blocks[block].content}</pre>}
          <p className="settings-help">
            {mode === "source"
              ? "Inserts a copy of the editable source. The original note stays unchanged."
              : "References the existing file. No duplicate file is created."}
          </p>
        </section>
      )}
      {error && (
        <p className="danger-text" role="alert">
          {error.replace(/^Error: /, "")}
        </p>
      )}
      <footer>
        <button type="button" onClick={close}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!selected || busy || (mode === "source" && !blocks[block])}
          onClick={() => void apply()}
        >
          {busy ? "Loading…" : "Insert"}
        </button>
      </footer>
    </dialog>
  );
}
