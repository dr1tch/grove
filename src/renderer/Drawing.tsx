import "./excalidraw-assets";
import { useEffect, useMemo, useRef, useState } from "react";
import { decodeDrawing, encodeDrawing } from "../shared/drawing";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { Excalidraw, serializeAsJSON } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
export default function Drawing({
  value,
  onChange,
  dark,
}: {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
}) {
  const data = useMemo(() => {
    try {
      return decodeDrawing(value);
    } catch {
      return null;
    }
  }, []);
  const last = useRef(value);
  const signature = useRef<string | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  useEffect(() => {
    if (api && value !== last.current) {
      try {
        const scene = decodeDrawing(value);
        last.current = value;
        signature.current = null;
        api.updateScene({ elements: scene.elements });
        if (scene.files) api.addFiles(Object.values(scene.files));
      } catch {}
    }
  }, [value, api]);
  if (!data)
    return (
      <div className="empty">
        <h2>Drawing format needs attention</h2>
        <p>This drawing is malformed. The original file is untouched.</p>
      </div>
    );
  return (
    <div className="drawing">
      <Excalidraw
        excalidrawAPI={setApi}
        theme={dark ? "dark" : "light"}
        initialData={{
          elements: data.elements || [],
          appState: {
            currentItemRoughness: 0,
            currentItemFontFamily: 2,
            currentItemRoundness: "round",
            currentItemArrowType: "elbow",
            currentItemFillStyle: "solid",
            currentItemStrokeWidth: 1,
            ...data.appState,
            collaborators: undefined,
            theme: dark ? "dark" : "light",
          },
          files: data.files || {},
        }}
        onChange={(elements, appState, files) => {
          const next = JSON.stringify([elements, files]);
          if (signature.current === null) {
            signature.current = next;
            return;
          }
          if (signature.current === next) return;
          signature.current = next;
          const content = encodeDrawing(
            value,
            JSON.parse(serializeAsJSON(elements, appState, files, "local")),
          );
          if (content !== last.current) {
            last.current = content;
            onChange(content);
          }
        }}
        UIOptions={{
          canvasActions: {
            loadScene: false,
            saveToActiveFile: false,
            export: { saveFileToDisk: true },
          },
        }}
      />
    </div>
  );
}
