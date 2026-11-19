import { Toolbar, Toggle } from "radix-ui";
import { Minus, Plus, Scan, Maximize2, Minimize2 } from "lucide-react";
import { Tooltip } from "./Tooltip";
export function ViewControls({
  zoom,
  fitWidth,
  fullscreen,
  onZoom,
  onFit,
  onFullscreen,
  label = "Document view",
}: {
  zoom: number;
  fitWidth: boolean;
  fullscreen: boolean;
  onZoom: (zoom: number) => void;
  onFit: () => void;
  onFullscreen: () => void;
  label?: string;
}) {
  return (
    <Toolbar.Root className="document-controls" aria-label={label}>
      <Tooltip text="Zoom out">
        <Toolbar.Button
          aria-label="Zoom out"
          disabled={zoom <= 0.5}
          onClick={() => onZoom(Math.max(0.5, Math.round((zoom - 0.1) * 10) / 10))}
        >
          <Minus />
        </Toolbar.Button>
      </Tooltip>
      <Tooltip text="Reset zoom to 100%">
        <Toolbar.Button aria-label="Reset document zoom" onClick={() => onZoom(1)}>
          {Math.round(zoom * 100)}%
        </Toolbar.Button>
      </Tooltip>
      <Tooltip text="Zoom in">
        <Toolbar.Button
          aria-label="Zoom in"
          disabled={zoom >= 3}
          onClick={() => onZoom(Math.min(3, Math.round((zoom + 0.1) * 10) / 10))}
        >
          <Plus />
        </Toolbar.Button>
      </Tooltip>
      <Tooltip text="Fit width">
        <Toolbar.Button asChild>
          <Toggle.Root aria-label="Fit width" pressed={fitWidth} onPressedChange={onFit}>
            <Scan />
          </Toggle.Root>
        </Toolbar.Button>
      </Tooltip>
      <Tooltip text={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
        <Toolbar.Button asChild>
          <Toggle.Root
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
            pressed={fullscreen}
            onPressedChange={onFullscreen}
          >
            {fullscreen ? <Minimize2 /> : <Maximize2 />}
          </Toggle.Root>
        </Toolbar.Button>
      </Tooltip>
    </Toolbar.Root>
  );
}
