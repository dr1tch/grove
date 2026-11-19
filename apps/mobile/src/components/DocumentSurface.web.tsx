import { useCallback, useEffect, useRef } from "react";
import { editorHtml } from "../../editor/generated";
import { useDocumentBridge } from "./useDocumentBridge";
import type { DocumentSurfaceProps } from "./DocumentSurface.types";
export type { DocumentSurfaceProps, SurfaceCommand } from "./DocumentSurface.types";
function WebSurface(props: DocumentSurfaceProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const deliver = useCallback(
    (message: string) => frame.current?.contentWindow?.postMessage(message, "*"),
    [],
  );
  const { receive, probe } = useDocumentBridge(props, deliver);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      // Sandboxed srcDoc has an opaque origin. Match its Window, never trust origin alone.
      if (event.source === frame.current?.contentWindow) receive(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [receive]);
  return (
    <iframe
      ref={frame}
      srcDoc={editorHtml}
      title={props.mode === "edit" ? "Markdown editor" : "Note reading view"}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={probe}
      style={{
        border: 0,
        width: "100%",
        height: "100%",
        flex: 1,
        minHeight: 0,
        display: "block",
        background: props.dark ? "#242521" : "#faf9f5",
      }}
    />
  );
}
export function DocumentSurface(props: DocumentSurfaceProps) {
  return <WebSurface key={props.documentId} {...props} />;
}
export default DocumentSurface;
