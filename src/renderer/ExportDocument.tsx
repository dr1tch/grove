import { useEffect, useRef, useState } from "react";
import type { ExportInfo } from "../shared/types";
import { Markdown } from "./Markdown";
import "./excalidraw-assets";
export function ExportDocument() {
  const [info, setInfo] = useState<ExportInfo>(),
    [error, setError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void window.folio
      .exportInfo()
      .then((info) => {
        document.documentElement.dataset.theme = info.theme;
        document.documentElement.dataset.reading = "full";
        setInfo(info);
      })
      .catch((error) => setError(String(error)));
  }, []);
  useEffect(() => {
    if (!info) return;
    let live = true;
    void (async () => {
      await document.fonts.ready;
      const start = performance.now();
      let pending = true;
      while (live && performance.now() - start < 15000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const element = host.current!;
        pending =
          !!element.querySelector('[data-export-ready="false"]') ||
          [...element.querySelectorAll("img")].some((img) => !img.complete);
        if (!pending && performance.now() - start > 500) break;
      }
      if (!live) return;
      const element = host.current!,
        warnings: string[] = [];
      if (pending)
        warnings.push(
          "Some diagrams or source formatting did not finish. Review the export for omissions.",
        );
      for (const item of element.querySelectorAll(".error-text,.drawing-caption,.muted"))
        if (/unavailable|error|failed/i.test(item.textContent || ""))
          warnings.push(item.textContent || "Unavailable preview");
      for (const image of element.querySelectorAll("img"))
        if (!image.naturalWidth) warnings.push(`Image unavailable: ${image.alt}`);
      const article = element.querySelector(".md");
      if (!article) throw new Error("Export document did not render");
      const copy = article.cloneNode(true) as HTMLElement;
      for (const control of copy.querySelectorAll("button,.document-outline")) control.remove();
      await window.folio.exportReady(copy.outerHTML, warnings);
    })().catch((error) => {
      if (live) setError(String(error));
    });
    return () => {
      live = false;
    };
  }, [info]);
  return (
    <div className="export-renderer" ref={host}>
      {info && (
        <Markdown
          doc={info.document}
          value={info.content}
          onChange={() => {}}
          open={() => {}}
          dark={info.theme === "dark"}
        />
      )}{" "}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
