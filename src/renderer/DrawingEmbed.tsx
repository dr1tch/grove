import "./excalidraw-assets";
import { useEffect, useRef, useState } from "react";
import { decodeDrawing } from "../shared/drawing";
export function DrawingEmbed({
  path,
  dark,
  open,
}: {
  path: string;
  dark: boolean;
  open: (p: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState("Loading drawing…");
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const doc = await window.folio.read(path);
        const scene = decodeDrawing(doc.content);
        const { exportToSvg } = await import("@excalidraw/excalidraw");
        const svg = await exportToSvg({
          elements: scene.elements,
          appState: { ...scene.appState, exportWithDarkMode: dark },
          files: scene.files || {},
          exportPadding: 24,
        });
        if (live && host.current) {
          host.current.replaceChildren(svg);
          const connectors = scene.elements.filter((e) => ["arrow", "line"].includes(e.type));
          setSummary(
            `${scene.elements.length - connectors.length} shapes · ${connectors.length} connections`,
          );
        }
      } catch {
        if (live) setSummary("Drawing preview unavailable");
      }
    })();
    return () => {
      live = false;
    };
  }, [path, dark]);
  return (
    <span className="drawing-embed" data-export-ready={summary !== "Loading drawing…"}>
      <span className="drawing-preview" ref={host} />
      <span className="drawing-caption">
        <span>
          {path.split("/").pop()} · {summary}
        </span>
        <button onClick={() => open(path)}>✎ Edit drawing</button>
      </span>
    </span>
  );
}
