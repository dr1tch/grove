// Load bundled fonts before Excalidraw, in both Electron and the browser project subpath.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = new URL(
  "excalidraw-assets/",
  document.baseURI,
).href;
