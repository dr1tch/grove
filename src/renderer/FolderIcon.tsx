import {
  Code2,
  FileText,
  BookOpen,
  Image,
  Palette,
  Play,
  FlaskConical,
  Settings2,
  Archive,
  Package,
  Users,
  Briefcase,
} from "lucide-react";
import { folderStyle } from "../shared/tree";
const badges = {
  code: Code2,
  docs: BookOpen,
  notes: FileText,
  images: Image,
  design: Palette,
  media: Play,
  tests: FlaskConical,
  config: Settings2,
  archive: Archive,
  packages: Package,
  people: Users,
  projects: Briefcase,
};
export function FolderIcon({ path, size = 18 }: { path: string; size?: number }) {
  const style = folderStyle(path);
  const Badge = style === "default" ? null : badges[style];
  return (
    <span
      className={`folder-type-icon folder-${style}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M2.5 7a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2Z"
          fill="currentColor"
          fillOpacity=".18"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path d="M3 9h18" stroke="currentColor" strokeWidth="1.2" opacity=".5" />
      </svg>
      {Badge && <Badge className="folder-badge" size={10} strokeWidth={2.2} />}
    </span>
  );
}
export function GroveMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      className="grove-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path d="M16 26V15" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" />
      <path
        d="M15.8 19.5C7 20 4.6 15.5 5 7.5c8-.4 12.2 2 10.8 12Z"
        fill="currentColor"
        opacity=".8"
      />
      <path d="M16 16.5C15 8.5 19 4.5 27 5c.6 8.1-3 12.8-11 11.5Z" fill="currentColor" />
    </svg>
  );
}
