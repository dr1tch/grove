import type { SurfaceCommand } from "../../editor/protocol";
export type { SurfaceCommand };
export type DocumentSurfaceProps = {
  documentId: string;
  value: string;
  mode: "read" | "edit";
  dark: boolean;
  onChange: (value: string) => void;
  onReady?: () => void;
  onError?: (message: string) => void;
  command?: SurfaceCommand;
};
