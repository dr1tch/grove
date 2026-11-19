import { groveSmall, groveMark } from "../brand";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ChevronDown,
  ChevronRight,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  X,
} from "lucide-react-native";
import { SvgXml } from "react-native-svg";
import type { VaultEntry } from "@grove/github-vault/types";
import { FileIcon, FolderIcon } from "./FileIcon";
import { theme } from "../theme";

export type FilesScreenProps = {
  entries: VaultEntry[];
  recent: string[];
  name: string;
  status: string;
  busy: boolean;
  dark: boolean;
  onOpen: (path: string) => void;
  onNew: () => void;
  onSync: () => void;
  onSettings: () => void;
  onToggleTheme: () => void;
};

type Row =
  | { type: "heading"; key: string; label: string }
  | { type: "folder"; key: string; path: string; name: string; depth: number }
  | {
      type: "file";
      key: string;
      entry: VaultEntry;
      depth: number;
      recent?: boolean;
    };

function label(entry: VaultEntry) {
  return entry.kind === "markdown" ? entry.name.replace(/\.(md|markdown)$/i, "") : entry.name;
}

function buildRows(
  entries: VaultEntry[],
  recent: string[],
  collapsed: Set<string>,
  query: string,
): Row[] {
  const files = entries.filter((entry) => entry.kind !== "folder");
  if (query.trim())
    return files
      .filter((entry) => entry.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((entry) => ({
        type: "file",
        key: `search:${entry.path}`,
        entry,
        depth: 0,
      }));
  const rows: Row[] = [];
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const recentFiles = [...new Set(recent)]
    .map((path) => byPath.get(path))
    .filter((entry): entry is VaultEntry => Boolean(entry))
    .slice(0, 5);
  if (recentFiles.length) {
    rows.push({ type: "heading", key: "heading:recent", label: "Recent" });
    rows.push(
      ...recentFiles.map((entry): Row => ({
        type: "file",
        key: `recent:${entry.path}`,
        entry,
        depth: 0,
        recent: true,
      })),
    );
  }
  if (!entries.length) return rows;
  rows.push({
    type: "heading",
    key: "heading:files",
    label: "Folders & files",
  });
  const folders = new Set<string>();
  const children = new Map<string, { folders: string[]; files: VaultEntry[] }>();
  const group = (path: string) => {
    let result = children.get(path);
    if (!result) {
      result = { folders: [], files: [] };
      children.set(path, result);
    }
    return result;
  };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    if (entry.kind !== "folder") parts.pop();
    for (let index = 1; index <= parts.length; index++)
      folders.add(parts.slice(0, index).join("/"));
    if (entry.kind !== "folder") group(parts.join("/")).files.push(entry);
  }
  for (const path of folders)
    group(path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "").folders.push(path);
  const walk = (path: string, depth: number) => {
    const current = children.get(path);
    if (!current) return;
    for (const folder of current.folders.sort((a, b) => a.localeCompare(b))) {
      rows.push({
        type: "folder",
        key: `folder:${folder}`,
        path: folder,
        name: folder.split("/").pop()!,
        depth,
      });
      if (!collapsed.has(folder)) walk(folder, depth + 1);
    }
    for (const entry of current.files.sort((a, b) => a.name.localeCompare(b.name)))
      rows.push({ type: "file", key: `file:${entry.path}`, entry, depth });
  };
  walk("", 0);
  return rows;
}

export function FilesScreen({
  entries,
  recent,
  name,
  status,
  busy,
  dark,
  onOpen,
  onNew,
  onSync,
  onSettings,
  onToggleTheme,
}: FilesScreenProps) {
  const palette = theme(dark);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const rows = useMemo(
    () => buildRows(entries, recent, collapsed, query),
    [entries, recent, collapsed, query],
  );
  const toggle = (path: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const iconButton = (
    text: string,
    onPress: () => void,
    icon: React.ReactNode,
    disabled = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={text}
      disabled={disabled}
      accessibilityState={{ disabled }}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: palette.raised }]}
    >
      {icon}
    </Pressable>
  );
  return (
    <View style={[styles.screen, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <View style={[styles.mark, dark && { backgroundColor: "transparent" }]}>
            <SvgXml xml={dark ? groveSmall : groveMark} width={38} height={38} />
          </View>
          <View style={styles.identityText}>
            <Text numberOfLines={1} style={[styles.vaultName, { color: palette.text }]}>
              {name || "Grove"}
            </Text>
            <Text
              numberOfLines={2}
              accessibilityLiveRegion="polite"
              style={[styles.status, { color: palette.muted }]}
            >
              {status}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {iconButton(
            "Sync vault",
            onSync,
            busy ? (
              <ActivityIndicator size="small" color={palette.accent} />
            ) : (
              <RefreshCw size={19} color={palette.muted} />
            ),
            busy,
          )}
          {iconButton(
            dark ? "Use light theme" : "Use dark theme",
            onToggleTheme,
            dark ? <Sun size={21} color={palette.text} /> : <Moon size={21} color={palette.text} />,
          )}
          {iconButton("Settings", onSettings, <Settings2 size={21} color={palette.text} />)}
        </View>
      </View>
      <View style={[styles.search, { backgroundColor: palette.raised }]}>
        <Search size={19} color={palette.muted} />
        <TextInput
          accessibilityLabel="Search files"
          placeholder="Search files"
          placeholderTextColor={palette.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.searchInput, { color: palette.text }]}
        />
        {query.length > 0 &&
          iconButton("Clear search", () => setQuery(""), <X size={18} color={palette.muted} />)}
      </View>
      <FlatList<Row>
        data={rows}
        keyExtractor={(row) => row.key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.type === "heading")
            return (
              <Text accessibilityRole="header" style={[styles.section, { color: palette.muted }]}>
                {item.label}
              </Text>
            );
          if (item.type === "folder") {
            const open = !collapsed.has(item.path);
            const Chevron = open ? ChevronDown : ChevronRight;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.path}
                accessibilityState={{ expanded: open }}
                onPress={() => toggle(item.path)}
                style={({ pressed }) => [
                  styles.row,
                  { paddingLeft: 4 + Math.min(item.depth, 6) * 16 },
                  pressed && { backgroundColor: palette.raised },
                ]}
              >
                <Chevron size={18} color={palette.muted} />
                <FolderIcon path={item.path} dark={dark} />
                <Text numberOfLines={1} style={[styles.folderName, { color: palette.text }]}>
                  {item.name}
                </Text>
              </Pressable>
            );
          }
          const { entry } = item;
          const preview = !["markdown", "text"].includes(entry.kind);
          const conflict = /\(conflict\b/i.test(entry.name);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${entry.path}${conflict ? ", conflict copy" : ""}`}
              onPress={() => onOpen(entry.path)}
              style={({ pressed }) => [
                styles.row,
                {
                  paddingLeft: item.recent || query ? 6 : 28 + Math.min(item.depth, 6) * 16,
                },
                pressed && { backgroundColor: palette.raised },
              ]}
            >
              <FileIcon path={entry.path} size={25} dark={dark} />
              <View style={styles.fileText}>
                <Text numberOfLines={1} style={[styles.fileName, { color: palette.text }]}>
                  {label(entry)}
                </Text>
                {Boolean(query) && entry.path.includes("/") && (
                  <Text numberOfLines={1} style={[styles.filePath, { color: palette.muted }]}>
                    {entry.path.slice(0, entry.path.lastIndexOf("/"))}
                  </Text>
                )}
              </View>
              {!item.recent && (conflict || preview) && (
                <View style={[styles.badge, { borderColor: conflict ? "#a98a35" : palette.line }]}>
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color: conflict ? (dark ? "#e6bc6c" : "#8a5b00") : palette.muted,
                      },
                    ]}
                  >
                    {conflict ? "Conflict copy" : "Preview"}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, { color: palette.text }]}>
              {query ? "No matching files" : busy ? "Loading your vault" : "Your vault is ready"}
            </Text>
            <Text style={[styles.emptyText, { color: palette.muted }]}>
              {query
                ? "Try another name or folder."
                : busy
                  ? "Fetching files. Cached notes stay available offline."
                  : "Create your first note with the plus button."}
            </Text>
          </View>
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New note"
        onPress={onNew}
        style={({ pressed }) => [
          styles.newNote,
          { backgroundColor: palette.accent, opacity: pressed ? 0.8 : 1 },
        ]}
      >
        <Plus size={24} color={dark ? "#022c22" : "#ffffff"} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 4,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 10,
    minWidth: 0,
  },
  identityText: { flex: 1, minWidth: 0 },
  mark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: "#f4f5e9",
    alignItems: "center",
    justifyContent: "center",
  },
  vaultName: { fontFamily: "Geist", fontSize: 21, fontWeight: "600" },
  status: { fontFamily: "Geist", fontSize: 11, lineHeight: 16, marginTop: 3 },
  headerActions: { flexDirection: "row", flexShrink: 0 },
  iconButton: {
    minWidth: 44,
    minHeight: 44,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    marginHorizontal: 18,
    paddingLeft: 14,
    paddingRight: 4,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    fontFamily: "Geist",
    fontSize: 16,
    paddingVertical: 10,
  },
  list: { paddingHorizontal: 18, paddingBottom: 104 },
  section: {
    fontFamily: "Geist",
    fontSize: 13,
    fontWeight: "600",
    paddingTop: 26,
    paddingBottom: 12,
    paddingLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: 11,
    paddingRight: 4,
    paddingVertical: 9,
    borderRadius: 8,
  },
  folderName: { flex: 1, fontFamily: "Geist", fontSize: 16, fontWeight: "600" },
  fileText: { flex: 1, minWidth: 0 },
  fileName: { fontFamily: "Geist", fontSize: 16 },
  filePath: { fontFamily: "Geist", fontSize: 11, marginTop: 3 },
  badge: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexShrink: 0,
  },
  badgeText: { fontFamily: "Geist", fontSize: 10 },
  newNote: {
    position: "absolute",
    right: 22,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
    shadowOpacity: 0.15,
  },
  empty: {
    paddingHorizontal: 24,
    paddingVertical: 54,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: {
    fontFamily: "Geist",
    fontSize: 18,
    fontWeight: "600",
    textAlign: "center",
  },
  emptyText: {
    fontFamily: "Geist",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
});
