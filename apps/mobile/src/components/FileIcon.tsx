import { View } from "react-native";
import Svg, { Path, Text as SvgText } from "react-native-svg";
import {
  Archive,
  BookOpen,
  Briefcase,
  Code2,
  FileText,
  FlaskConical,
  Image,
  Music2,
  Package,
  Palette,
  Play,
  Settings2,
  Users,
  Video,
} from "lucide-react-native";
import { fileIconSpec } from "@grove/core/file-icons";
import { folderStyle } from "@grove/core/tree";
import { folderColors, theme } from "../theme";

const colors: Record<string, string> = {
  blue: "#4d99d1",
  red: "#d56c68",
  pink: "#cc82a5",
  purple: "#a58ad4",
  orange: "#d09058",
  cyan: "#4aa9be",
  green: "#4caa87",
  yellow: "#bd9b2f",
};

export function FileIcon({
  path,
  size = 24,
  dark = false,
}: {
  path: string;
  size?: number;
  dark?: boolean;
}) {
  const spec = fileIconSpec(path);
  const color =
    dark && spec.color === "blue"
      ? "#7ab4e1"
      : dark && spec.color === "yellow"
        ? "#ddc36b"
        : colors[spec.color] || theme(dark).muted;
  const Pictogram = {
    image: Image,
    audio: Music2,
    video: Video,
    archive: Archive,
  }[spec.mark];
  if (Pictogram)
    return (
      <Pictogram size={size} color={color} strokeWidth={1.6} accessibilityLabel={spec.label} />
    );
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityLabel={spec.label}>
      <Path
        d="M6 2.5h8l5 5v14H5V3.5a1 1 0 0 1 1-1Z"
        fill={color}
        fillOpacity={0.12}
        stroke={color}
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      <Path d="M14 2.8v5h4.8" fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
      {spec.mark ? (
        <SvgText
          x={12}
          y={16.8}
          textAnchor="middle"
          fill={color}
          fontFamily="Geist"
          fontWeight="700"
          fontSize={spec.mark.length > 2 ? 6.2 : spec.mark.length > 1 ? 7.5 : 10.5}
        >
          {spec.mark}
        </SvgText>
      ) : (
        <Path d="M8 12h8m-8 4h6" stroke={color} strokeWidth={1.2} />
      )}
    </Svg>
  );
}

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

export function FolderIcon({
  path,
  size = 26,
  dark = false,
}: {
  path: string;
  size?: number;
  dark?: boolean;
}) {
  const kind = folderStyle(path);
  const color = kind === "default" ? theme(dark).muted : folderColors[kind];
  const Badge = kind === "default" ? null : badges[kind];
  return (
    <View style={{ width: size, height: size }} accessible={false}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
          d="M2.5 7a2 2 0 0 1 2-2h5l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2Z"
          fill={color}
          fillOpacity={0.18}
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <Path d="M3 9h18" stroke={color} strokeWidth={1.2} opacity={0.5} />
      </Svg>
      {Badge && (
        <View
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            backgroundColor: theme(dark).background,
            borderRadius: 3,
          }}
        >
          <Badge size={size * 0.48} color={color} strokeWidth={2.2} />
        </View>
      )}
    </View>
  );
}
