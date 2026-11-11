import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { pdfPageText, textMatches } from "../shared/search";
import type { ViewState } from "../shared/types";
export function PdfSearch({
  pdf,
  page,
  viewport,
  find,
}: {
  pdf: PDFDocumentProxy;
  page: number;
  viewport: ReturnType<PDFPageProxy["getViewport"]>;
  find: NonNullable<ViewState["find"]>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [boxes, setBoxes] = useState<
    { left: number; top: number; width: number; height: number; active: boolean }[]
  >([]);
  useEffect(() => {
    let live = true;
    void pdf
      .getPage(page)
      .then((p) => p.getTextContent())
      .then((content) => {
        const { text, spans } = pdfPageText(content.items),
          result = [];
        for (const hit of textMatches(text, find.query))
          for (const span of spans) {
            const from = Math.max(hit.from, span.from),
              to = Math.min(hit.to, span.to);
            if (to <= from || !span.item.str.length) continue;
            const item = span.item,
              x = item.transform[4] + (item.width * (from - span.from)) / item.str.length,
              y = item.transform[5];
            const [a, b, c, d, e, f] = viewport.transform;
            const right = x + (item.width * (to - from)) / item.str.length,
              top = y + item.height;
            const rectangle = [
              a * x + c * y + e,
              b * x + d * y + f,
              a * right + c * top + e,
              b * right + d * top + f,
            ];
            result.push({
              left: Math.min(rectangle[0], rectangle[2]),
              top: Math.min(rectangle[1], rectangle[3]),
              width: Math.abs(rectangle[2] - rectangle[0]),
              height: Math.abs(rectangle[3] - rectangle[1]),
              active: find.page === page && hit.from === find.from,
            });
          }
        if (live) setBoxes(result);
      })
      .catch(() => {
        if (live) setBoxes([]);
      });
    return () => {
      live = false;
    };
  }, [pdf, page, viewport, find]);
  useEffect(() => {
    host.current?.querySelector(".active")?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [boxes]);
  return (
    <div
      ref={host}
      className="pdf-search-layer"
      aria-label={`${boxes.length} highlighted text regions`}
    >
      {boxes.map((box, i) => (
        <mark
          key={i}
          className={box.active ? "active" : ""}
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      ))}
    </div>
  );
}
