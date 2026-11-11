import { Image, Music2, Video, Archive } from "lucide-react";
import { fileIconSpec } from "../shared/file-icons";
export function FileIcon({ path, size = 17 }: { path: string; size?: number }) {
  const spec = fileIconSpec(path);
  const pictogram = { image: Image, audio: Music2, video: Video, archive: Archive }[spec.mark];
  if (pictogram) {
    const I = pictogram;
    return (
      <I
        className={`file-type-icon file-${spec.color}`}
        size={size}
        aria-label={spec.label}
        role="img"
      />
    );
  }
  return (
    <svg
      className={`file-type-icon file-${spec.color}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={spec.label}
    >
      <path
        d="M6 2.5h8l5 5v14H5V3.5a1 1 0 0 1 1-1Z"
        fill="currentColor"
        fillOpacity=".12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M14 2.8v5h4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      {spec.mark ? (
        <text
          x="12"
          y="16.8"
          textAnchor="middle"
          fill="currentColor"
          fontFamily="Geist,system-ui,sans-serif"
          fontWeight="700"
          fontSize={spec.mark.length > 2 ? "6.2" : spec.mark.length > 1 ? "7.5" : "10.5"}
          stroke="none"
        >
          {spec.mark}
        </text>
      ) : (
        <path d="M8 12h8m-8 4h6" stroke="currentColor" strokeWidth="1.2" />
      )}
    </svg>
  );
}
