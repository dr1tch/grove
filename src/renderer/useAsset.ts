import { useEffect, useState } from "react";
export function useAsset(path: string, enabled = true) {
  const [revision, setRevision] = useState(0),
    [asset, setAsset] = useState({ url: "", error: "" });
  useEffect(
    () =>
      window.folio.onChange((changed) => {
        if (changed === path) setRevision((value) => value + 1);
      }),
    [path],
  );
  useEffect(() => {
    const api = window.folio;
    let live = true,
      url = "";
    setAsset({ url: "", error: "" });
    if (!enabled) return;
    void api
      .asset(path)
      .then((value) => {
        url = value;
        if (live) setAsset({ url, error: "" });
        else void api.releaseAsset(url);
      })
      .catch((error) => {
        if (live) setAsset({ url: "", error: String(error) });
      });
    return () => {
      live = false;
      if (url) void api.releaseAsset(url);
    };
  }, [path, revision, enabled]);
  return asset;
}
