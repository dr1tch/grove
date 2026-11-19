import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import {
  Bold,
  Code2,
  Heading,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Paperclip,
  Quote,
  Redo2,
  Table2,
  Undo2,
  type LucideIcon,
} from "lucide-react-native";
import type { MarkdownAction } from "@grove/core/markdown-format";
import { theme } from "../theme";

export type MarkdownToolbarProps = {
  dark: boolean;
  onCommand: (action: MarkdownAction | "undo" | "redo") => void;
  onInsert: () => void;
};

const actions: {
  action: MarkdownAction | "undo" | "redo";
  label: string;
  Icon: LucideIcon;
}[] = [
  { action: "h1", label: "Heading", Icon: Heading },
  { action: "bold", label: "Bold", Icon: Bold },
  { action: "italic", label: "Italic", Icon: Italic },
  { action: "quote", label: "Quote", Icon: Quote },
  { action: "code", label: "Code", Icon: Code2 },
  { action: "link", label: "Link", Icon: Link },
  { action: "bullet", label: "Bullet list", Icon: List },
  { action: "ordered", label: "Numbered list", Icon: ListOrdered },
  { action: "task", label: "Task list", Icon: ListChecks },
  { action: "table", label: "Table", Icon: Table2 },
  { action: "undo", label: "Undo", Icon: Undo2 },
  { action: "redo", label: "Redo", Icon: Redo2 },
];

export function MarkdownToolbar({ dark, onCommand, onInsert }: MarkdownToolbarProps) {
  const palette = theme(dark);
  return (
    <View style={[styles.toolbar, { backgroundColor: palette.surface, borderColor: palette.line }]}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.actions}
        style={styles.scroll}
      >
        {actions.map(({ action, label, Icon }) => (
          <Pressable
            key={action}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => onCommand(action)}
            style={({ pressed }) => [styles.button, pressed && { backgroundColor: palette.raised }]}
          >
            <Icon size={21} color={palette.text} strokeWidth={1.7} />
          </Pressable>
        ))}
      </ScrollView>
      <View style={[styles.insert, { borderLeftColor: palette.line }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Insert from vault"
          onPress={onInsert}
          style={({ pressed }) => [styles.button, pressed && { backgroundColor: palette.raised }]}
        >
          <Paperclip size={22} color={palette.text} strokeWidth={1.7} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    minHeight: 52,
    alignItems: "center",
  },
  scroll: { flex: 1 },
  actions: { paddingHorizontal: 4, alignItems: "center" },
  button: {
    width: 44,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  insert: { borderLeftWidth: 1, paddingHorizontal: 4, flexShrink: 0 },
});
