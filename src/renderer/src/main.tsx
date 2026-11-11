import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/jetbrains-mono/400-italic.css";
import "../styles.css";
import { App } from "../App";
import { StandaloneViewer } from "../Viewer";
import { ExportDocument } from "../ExportDocument";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("export") ? (
      <ExportDocument />
    ) : new URLSearchParams(location.search).has("viewer") ? (
      <StandaloneViewer />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
