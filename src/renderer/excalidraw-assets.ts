// Excalidraw loads its fonts from this path; import this module before any Excalidraw code,
// otherwise it falls back to esm.sh, which the CSP blocks.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH =
  "folio://app/excalidraw-assets/";
