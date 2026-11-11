import { useEffect, useState } from "react";
export function HtmlPreview({ path, value, root }: { path: string; value: string; root: string }) {
  const [preview, setPreview] = useState<{ url: string; warnings: string[] }>(),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true,
      url = "";
    const timer = setTimeout(
      () =>
        void window.folio
          .htmlPreview(path, value, root)
          .then((result) => {
            url = result.url;
            if (live) {
              setPreview(result);
              setError("");
            } else void window.folio.revokeHtmlPreview(url, root).catch(() => {});
          })
          .catch((error) => {
            if (live) setError(String(error));
          }),
      250,
    );
    return () => {
      live = false;
      clearTimeout(timer);
      if (url) void window.folio.revokeHtmlPreview(url, root).catch(() => {});
    };
  }, [root, path, value]);
  return (
    <section className="html-preview">
      <header>Offline preview · scripts and external resources are disabled</header>
      {error && <p role="alert">{error}</p>}
      {preview?.warnings.length ? (
        <details>
          <summary>{preview.warnings.length} omitted or missing resources</summary>
          {preview.warnings.map((warning, i) => (
            <p key={i}>{warning}</p>
          ))}
        </details>
      ) : null}
      {preview ? (
        <iframe title={`HTML preview: ${path}`} sandbox="" src={preview.url} />
      ) : (
        <p>Preparing preview…</p>
      )}
    </section>
  );
}
