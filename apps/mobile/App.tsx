import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { randomUUID } from "expo-crypto";
import * as Network from "expo-network";
import { useFonts } from "expo-font";
import { Geist_400Regular } from "@expo-google-fonts/geist";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4";
import { JetBrainsMono_400Regular } from "@expo-google-fonts/jetbrains-mono";
import { ArrowLeft, Check, ChevronDown, Search, X } from "lucide-react-native";
import { FileIcon } from "./src/components/FileIcon";
import { Captcha } from "./src/components/Captcha";
import { VaultSession } from "@grove/github-vault/sync";
import { VaultStore } from "@grove/github-vault/store";
import { CloudStore } from "@grove/github-vault/cloud";
import { GitHubError } from "@grove/github-vault/types";
import type { VaultEntry } from "@grove/github-vault/types";
import type { RemoteStore } from "@grove/github-vault/remote";
import type { Document, SyncStatus } from "@grove/core/types";
import { conflictCopyName } from "@grove/core/conflicts";
import { mermaidBlocks } from "@grove/core/vault-insert";
import { kindOf } from "@grove/core/files";
import type { MarkdownAction } from "@grove/core/markdown-format";
import {
  accounts,
  captchaUrl,
  forgetConnection,
  loadConnection,
  resetPassword,
  saveConnection,
  signInEmail,
  signInGitHub,
} from "./src/auth";
import type { MobileConnection } from "./src/auth";
import { openVaultCache } from "./src/cache";
import { loadLocal, saveLocal } from "./src/local";
import { sampleStore } from "./src/demo";
import { insertReference, noteDestination, proposedName, recoveryNote } from "./src/draft";
import type { NoteState } from "./src/draft";
import { FilesScreen } from "./src/components/Files";
import { SvgXml } from "react-native-svg";
import { groveSmall } from "./src/brand";
import DocumentSurface from "./src/components/DocumentSurface";
import type { SurfaceCommand } from "./src/components/DocumentSurface";
import { MarkdownToolbar } from "./src/components/MarkdownToolbar";
import { theme } from "./src/theme";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const dirty = (note: NoteState) => note.draft || note.value !== note.saved;
const fromDocument = (document: Document): NoteState => ({
  id: randomUUID(),
  path: document.path,
  value: document.content,
  saved: document.content,
  hash: document.hash,
  draft: false,
});
type Sheet = "settings" | "save" | "leave" | "insert" | "conflict" | null;
type Diagram = {
  path: string;
  hash: string;
  index: number;
  label: string;
  content: string;
  reviewed: boolean;
};

export default function App() {
  const [fonts, fontError] = useFonts({
    Geist: Geist_400Regular,
    SourceSerif: SourceSerif4_400Regular,
    JetBrainsMono: JetBrainsMono_400Regular,
  });
  return (
    <SafeAreaProvider>
      <Grove ready={fonts || !!fontError} />
    </SafeAreaProvider>
  );
}

function Grove({ ready }: { ready: boolean }) {
  const insets = useSafeAreaInsets();
  const systemDark = useColorScheme() === "dark";
  const [dark, setDark] = useState(systemDark);
  const palette = theme(dark);
  const [session, setSession] = useState<VaultSession>();
  const active = useRef<VaultSession | undefined>(undefined);
  const generation = useRef(0);
  const readSequence = useRef(0);
  const [connection, setConnection] = useState<MobileConnection>();
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [note, setNoteState] = useState<NoteState>();
  const noteRef = useRef<NoteState | undefined>(undefined);
  const [mode, setMode] = useState<"read" | "edit">("read");
  const [status, setStatus] = useState("Opening Grove");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [query, setQuery] = useState("");
  const [insertCategory, setInsertCategory] = useState<"All" | "Media" | "Diagrams" | "Charts">(
    "All",
  );
  const [selectedFile, setSelectedFile] = useState("");
  const [insertAs, setInsertAs] = useState<"embed" | "link">("embed");
  const [chooseFolder, setChooseFolder] = useState(false);
  const [conflict, setConflict] = useState<Document>();
  const [diagram, setDiagram] = useState<Diagram>();
  const [diagramChoices, setDiagramChoices] = useState<Diagram[]>([]);
  const [command, setCommand] = useState<SurfaceCommand>();
  const commandId = useRef(0);
  const insertOwner = useRef("");
  const insertPickerSequence = useRef(0);
  const leaveAfterSave = useRef(false);
  const recoveryWrites = useRef<Promise<unknown>>(Promise.resolve());
  const syncRuns = useRef(new Map<VaultSession, Promise<void>>());
  const syncRequested = useRef(new Set<VaultSession>());
  const syncTimers = useRef(new Map<VaultSession, ReturnType<typeof setTimeout>>());
  const recoveryKey = (current: VaultSession) => `recovery:${current.store.root}`;
  const persist = useCallback((current: VaultSession, value: NoteState | undefined) => {
    const key = recoveryKey(current);
    const snapshot = value && dirty(value) ? { ...value } : undefined;
    const operation = recoveryWrites.current.catch(() => {}).then(() => saveLocal(key, snapshot));
    recoveryWrites.current = operation;
    return operation;
  }, []);
  const setNote = useCallback((value: NoteState | undefined) => {
    noteRef.current = value;
    setNoteState(value);
  }, []);
  const report = useCallback((error: unknown) => setStatus(message(error)), []);
  const lock = () => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  };
  const unlock = () => {
    busyRef.current = false;
    setBusy(false);
  };
  const syncLabel = (value: SyncStatus, sample: boolean) =>
    sample
      ? "Sample vault · changes stay on this device"
      : value.state === "synced"
        ? "All changes synced"
        : value.state === "syncing"
          ? "Syncing changes"
          : value.state === "offline"
            ? "Offline · saved changes wait on this device"
            : value.state === "conflict"
              ? `Conflict copies preserved${value.conflicts.length ? `: ${value.conflicts.join(", ")}` : ""}`
              : value.message || "Changes saved on this device";
  const refresh = async (current: VaultSession) => {
    const files = await current.list();
    if (active.current === current) setEntries(files);
  };
  const sync = (current = active.current): Promise<void> => {
    if (!current || active.current !== current) return Promise.resolve();
    const running = syncRuns.current.get(current);
    if (running) {
      syncRequested.current.add(current);
      return running;
    }
    const timer = syncTimers.current.get(current);
    if (timer) {
      clearTimeout(timer);
      syncTimers.current.delete(current);
    }
    let retryAllowed = false;
    const operation = (async () => {
      // A save can arrive during an upload. Drain its newer revision in another flush.
      // Yield after three passes so sustained editing cannot monopolize the foreground.
      for (let pass = 0; pass < 3 && active.current === current; pass++) {
        syncRequested.current.delete(current);
        const result = await current.syncNow();
        if (active.current !== current) return;
        setStatus(syncLabel(result, current.store.root === "sample:grove"));
        retryAllowed =
          !["offline", "error", "off"].includes(result.state) &&
          !(
            result.state === "conflict" &&
            result.message &&
            result.message !== "Newer local changes remain queued."
          );
        if (!retryAllowed) return;
        try {
          await refresh(current);
        } catch (error) {
          retryAllowed = false;
          if (active.current === current) report(error);
          return;
        }
        if (active.current !== current) return;
        const pending = await current.cache.pending();
        if (!pending.length && !syncRequested.current.has(current)) break;
        if (pass === 2) {
          syncTimers.current.set(
            current,
            setTimeout(() => {
              syncTimers.current.delete(current);
              if (active.current === current)
                void sync(current).catch((error) => {
                  if (active.current === current) report(error);
                });
            }, 300),
          );
        }
      }
    })()
      .catch((error) => {
        retryAllowed = false;
        throw error;
      })
      .finally(() => {
        syncRuns.current.delete(current);
        // A caller can queue another revision as the last pending read completes.
        const requested = syncRequested.current.delete(current);
        if (
          retryAllowed &&
          requested &&
          active.current === current &&
          !syncTimers.current.has(current)
        ) {
          syncTimers.current.set(
            current,
            setTimeout(() => {
              syncTimers.current.delete(current);
              if (active.current === current)
                void sync(current).catch((error) => {
                  if (active.current === current) report(error);
                });
            }, 300),
          );
        }
      });
    syncRuns.current.set(current, operation);
    return operation;
  };
  const connect = async (value?: MobileConnection, sample = false, restoring = false) => {
    if (!lock()) return;
    const ticket = ++generation.current;
    let next: VaultSession | undefined;
    let store: RemoteStore | undefined;
    try {
      if (sample) store = await sampleStore();
      else if (value?.kind === "github")
        store = new VaultStore(value.ref, value.token, {
          device: "Grove phone",
        });
      else if (value?.kind === "cloud" && accounts)
        store = new CloudStore(accounts, value.userId, "Grove phone");
      else throw new Error("Choose a vault connection.");
      // A newly entered credential must prove remote access before any private cache opens.
      // Only a previously saved connection may resume its cache after a network outage.
      let verifiedTree: VaultEntry[] | undefined;
      try {
        verifiedTree = await store.list();
      } catch (error) {
        if (!(restoring && error instanceof GitHubError && error.kind === "offline")) throw error;
      }
      if (generation.current !== ticket) {
        store.dispose();
        return;
      }
      next = new VaultSession(
        store,
        await openVaultCache(value?.kind === "github" ? value.ref : store.root),
      );
      if (verifiedTree) await next.cache.putTree(verifiedTree);
      const [savedTree, recovered, savedRecent] = await Promise.all([
        next.list(),
        loadLocal<unknown>(recoveryKey(next)),
        loadLocal<string[]>(`recent:${store.root}`),
      ]);
      if (generation.current !== ticket) {
        next.dispose();
        return;
      }
      if (value && !restoring) await saveConnection(value);
      if (generation.current !== ticket) {
        next.dispose();
        return;
      }
      active.current?.dispose();
      active.current = next;
      setSession(next);
      setConnection(value);
      setEntries(savedTree ?? []);
      setRecent(
        Array.isArray(savedRecent) ? savedRecent.filter((path) => typeof path === "string") : [],
      );
      const restored = recoveryNote(recovered);
      setNote(restored);
      setMode(restored ? "edit" : "read");
      setSheet(null);
      setStatus(
        restored
          ? "Recovered an unfinished note from this device. Save it when ready."
          : sample
            ? "Sample vault · changes stay on this device"
            : "Opening your vault",
      );
      const current = next;
      current.onSync((value) => {
        if (active.current === current) setStatus(syncLabel(value, sample));
      });
      try {
        await refresh(current);
        if (!restored) await sync(current);
      } catch (error) {
        if (active.current === current) report(error);
      }
    } catch (error) {
      if (next && active.current !== next) next.dispose();
      else if (!next) store?.dispose();
      if (generation.current === ticket) report(error);
    } finally {
      if (generation.current === ticket) unlock();
    }
  };
  useEffect(() => {
    let live = true;
    const startupGeneration = generation.current;
    loadConnection()
      .then((value) => {
        if (!live || generation.current !== startupGeneration) return;
        if (value) void connect(value, false, true);
        else setStatus("Your notes, always yours.");
      })
      .catch((error) => {
        if (live && generation.current === startupGeneration) report(error);
      });
    return () => {
      live = false;
      generation.current++;
      active.current?.dispose();
      active.current = undefined;
    };
  }, []);
  useEffect(() => {
    const resume = () => {
      const current = active.current;
      if (current)
        void sync(current).catch((error) => {
          if (active.current === current) report(error);
        });
    };
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") resume();
      else if (active.current) void persist(active.current, noteRef.current).catch(report);
    });
    if (Platform.OS === "web") window.addEventListener("online", resume);
    const network =
      Platform.OS === "web"
        ? undefined
        : Network.addNetworkStateListener((state) => {
            if (
              state.isConnected &&
              state.isInternetReachable !== false &&
              AppState.currentState === "active"
            )
              resume();
          });
    return () => {
      listener.remove();
      network?.remove();
      if (Platform.OS === "web") window.removeEventListener("online", resume);
      for (const timer of syncTimers.current.values()) clearTimeout(timer);
      syncTimers.current.clear();
    };
  }, [persist, report]);
  const closeNote = () => {
    if (busyRef.current) return;
    readSequence.current++;
    const current = noteRef.current;
    if (current && dirty(current)) {
      leaveAfterSave.current = true;
      setSheet("leave");
    } else {
      setNote(undefined);
      setSheet(null);
    }
  };
  useEffect(() => {
    if (Platform.OS === "web") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (busyRef.current) return true;
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (noteRef.current) {
        closeNote();
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [sheet]);
  const openNote = async (path: string) => {
    const current = active.current;
    if (!current || busyRef.current) return;
    const entry = entries.find((file) => file.path === path);
    if (!entry || !["markdown", "text"].includes(entry.kind)) {
      setStatus(
        "This file type is not available on the phone yet. Open it in Grove on desktop or web.",
      );
      return;
    }
    const ticket = ++readSequence.current;
    setStatus("Opening note");
    try {
      const document = await current.read(path);
      if (active.current !== current || ticket !== readSequence.current || noteRef.current) return;
      setNote(fromDocument(document));
      setMode("read");
      setCommand(undefined);
      const nextRecent = [path, ...recent.filter((item) => item !== path)].slice(0, 20);
      setRecent(nextRecent);
      await saveLocal(`recent:${current.store.root}`, nextRecent);
      if (active.current === current)
        setStatus(syncLabel(current.status(), current.store.root === "sample:grove"));
    } catch (error) {
      if (active.current === current && ticket === readSequence.current) report(error);
    }
  };
  const newNote = () => {
    if (!active.current || busyRef.current || noteRef.current) return;
    readSequence.current++;
    const value: NoteState = {
      id: randomUUID(),
      path: "",
      value: "",
      saved: "",
      hash: "",
      draft: true,
    };
    setNote(value);
    setMode("edit");
    setCommand(undefined);
    void persist(active.current, value).catch(report);
  };
  const change = (id: string, value: string) => {
    const current = noteRef.current;
    if (!current || current.id !== id || !active.current) return;
    const next = { ...current, value };
    setNote(next);
    void persist(active.current, next).catch(report);
  };
  const finishSave = async (current: VaultSession, before: NoteState, document: Document) => {
    if (active.current !== current || noteRef.current?.id !== before.id) return;
    const next = {
      ...noteRef.current,
      path: document.path,
      hash: document.hash,
      saved: before.value,
      draft: false,
    };
    setNote(next);
    await persist(current, next);
    if (active.current !== current || noteRef.current?.id !== before.id) return;
    setSheet(null);
    setConflict(undefined);
    if (leaveAfterSave.current && !dirty(noteRef.current)) setNote(undefined);
    leaveAfterSave.current = false;
    setStatus(
      current.store.root === "sample:grove"
        ? "Saved in the local sample vault"
        : "Saved on this device · waiting to sync",
    );
    void sync(current).catch((error) => {
      if (active.current === current) report(error);
    });
  };
  const save = async (first = false) => {
    const current = active.current,
      before = noteRef.current;
    if (!current || !before || !lock()) return;
    try {
      await persist(current, before);
      if (before.draft && !first) {
        setName(proposedName(before.value));
        setFolder("");
        setChooseFolder(false);
        setSheet("save");
        return;
      }
      const path = before.draft ? noteDestination(name, folder) : before.path;
      if (before.draft) await finishSave(current, before, await current.create(path, before.value));
      else {
        const result = await current.write(path, before.value, before.hash);
        if (active.current !== current || noteRef.current?.id !== before.id) return;
        if (result.status === "conflict") {
          setConflict(result.disk);
          setSheet("conflict");
        } else await finishSave(current, before, result.document);
      }
    } catch (error) {
      if (active.current === current) report(error);
    } finally {
      unlock();
    }
  };
  const discard = async () => {
    const current = active.current;
    if (!current || !lock()) return;
    try {
      await persist(current, undefined);
      setNote(undefined);
      setSheet(null);
      leaveAfterSave.current = false;
    } catch (error) {
      report(error);
    } finally {
      unlock();
    }
  };
  const resolve = async (choice: "both" | "mine" | "remote") => {
    const current = active.current,
      before = noteRef.current;
    if (!current || !before || !conflict || !lock()) return;
    try {
      const latest = await current.read(before.path);
      if (active.current !== current || noteRef.current?.id !== before.id) return;
      if (latest.hash !== conflict.hash) {
        setConflict(latest);
        setStatus("The other version changed again. Review it before choosing.");
        return;
      }
      if (choice === "remote") {
        setNote(fromDocument(latest));
        await persist(current, undefined);
        setSheet(null);
      } else if (choice === "both") {
        const files = await current.list();
        const path = conflictCopyName(before.path, "Grove phone", new Date(), (candidate) =>
          files.some((entry) => entry.path === candidate),
        );
        await finishSave(current, before, await current.create(path, before.value));
      } else {
        const result = await current.write(before.path, before.value, latest.hash);
        if (result.status === "conflict") setConflict(result.disk);
        else await finishSave(current, before, result.document);
      }
    } catch (error) {
      if (active.current === current) report(error);
    } finally {
      unlock();
    }
  };
  const send = (action: MarkdownAction | "undo" | "redo" | "insert", text?: string) => {
    if (!noteRef.current || mode !== "edit") return;
    setCommand({
      id: ++commandId.current,
      action,
      ...(text === undefined ? {} : { text }),
    });
  };
  const insert = (path: string, embed: boolean) => {
    if (noteRef.current?.id !== insertOwner.current || busyRef.current) return;
    if (embed && kindOf(path) === "markdown") {
      setStatus("Insert a link to this note, or choose an editable Mermaid block.");
      return;
    }
    send("insert", insertReference(path, embed));
    setSheet(null);
  };
  const findDiagram = async (path: string) => {
    const current = active.current,
      owner = insertOwner.current;
    if (!current || !lock()) return;
    const ticket = ++insertPickerSequence.current;
    try {
      const document = await current.read(path);
      if (
        active.current !== current ||
        noteRef.current?.id !== owner ||
        insertOwner.current !== owner ||
        ticket !== insertPickerSequence.current
      )
        return;
      const blocks = mermaidBlocks(document.content);
      if (!blocks.length) {
        setDiagram(undefined);
        setDiagramChoices([]);
        setInsertAs("link");
        setStatus("This saved note has no Mermaid blocks. Insert it as a link.");
        return;
      }
      const choices = blocks.map((block, index) => ({
        path,
        hash: document.hash,
        index,
        ...block,
        reviewed: true,
      }));
      setDiagramChoices(choices);
      setDiagram(choices[0]);
      setInsertAs("embed");
    } catch (error) {
      report(error);
    } finally {
      unlock();
    }
  };
  const addDiagram = async () => {
    const current = active.current,
      selected = diagram,
      owner = insertOwner.current;
    if (!current || !selected || !lock()) return;
    const pickerSequence = insertPickerSequence.current;
    try {
      const document = await current.read(selected.path);
      if (
        active.current !== current ||
        noteRef.current?.id !== owner ||
        insertOwner.current !== owner ||
        insertPickerSequence.current !== pickerSequence
      )
        return;
      const blocks = mermaidBlocks(document.content);
      const latest = blocks[selected.index];
      if (document.hash !== selected.hash || latest?.content !== selected.content) {
        if (!latest) {
          setDiagram(undefined);
          setStatus("This diagram was removed. Choose another saved note.");
        } else {
          setDiagram({
            path: selected.path,
            hash: document.hash,
            index: selected.index,
            ...latest,
            reviewed: true,
          });
          setStatus("The diagram changed. Review the updated preview and insert again.");
        }
        return;
      }
      send("insert", `\n${selected.content}\n`);
      setSheet(null);
      setDiagram(undefined);
    } catch (error) {
      report(error);
    } finally {
      unlock();
    }
  };
  const signOut = async () => {
    const current = active.current;
    if (!current || !lock()) return;
    try {
      await persist(current, noteRef.current);
      ++generation.current;
      ++readSequence.current;
      current.dispose();
      active.current = undefined;
      setSession(undefined);
      setConnection(undefined);
      setEntries([]);
      setRecent([]);
      setNote(undefined);
      setSheet(null);
      await forgetConnection();
      setStatus("Signed out. Drafts and pending changes stay on this device.");
    } catch (error) {
      report(error);
    } finally {
      unlock();
    }
  };
  const button = (label: string, onPress: () => void, primary = false, danger = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      accessibilityState={{ disabled: busy }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: primary
            ? palette.accent
            : danger
              ? dark
                ? "#412621"
                : "#fff0ed"
              : palette.raised,
          opacity: busy || pressed ? 0.6 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          {
            color: primary
              ? dark
                ? "#032b20"
                : "#ffffff"
              : danger
                ? palette.danger
                : palette.text,
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const field = (label: string, value: string, update: (value: string) => void) => (
    <View style={styles.field}>
      <Text style={{ color: palette.muted, fontFamily: "Geist" }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!busy}
        value={value}
        onChangeText={update}
        autoCapitalize="none"
        autoCorrect={false}
        style={[
          styles.input,
          {
            color: palette.text,
            borderColor: palette.line,
            backgroundColor: palette.background,
          },
        ]}
      />
    </View>
  );
  const folders = [
    "",
    ...entries.filter((entry) => entry.kind === "folder").map((entry) => entry.path),
  ];
  const cancelSheet = () => {
    insertPickerSequence.current++;
    leaveAfterSave.current = false;
    setSheet(null);
  };
  const insertFiles = entries.filter(
    (entry) =>
      entry.kind !== "folder" &&
      entry.path.toLowerCase().includes(query.toLowerCase()) &&
      (insertCategory === "All" ||
        (insertCategory === "Media" && ["image", "audio", "video"].includes(entry.kind)) ||
        (insertCategory === "Diagrams" && ["drawing", "markdown"].includes(entry.kind)) ||
        (insertCategory === "Charts" && entry.kind === "markdown")),
  );
  const parentFolder = note?.path.includes("/") ? note.path.split("/").slice(0, -1).pop() : "Files";

  if (!ready)
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: palette.background }]}>
        <ActivityIndicator color={palette.accent} />
      </SafeAreaView>
    );
  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: palette.background }]}
      edges={["top", "bottom", "left", "right"]}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      {!session ? (
        <SignIn
          dark={dark}
          busy={busy}
          status={status}
          onConnect={(value) => void connect(value)}
          onSample={() => void connect(undefined, true)}
          onStatus={setStatus}
        />
      ) : note ? (
        <KeyboardAvoidingView
          style={styles.root}
          behavior="padding"
          keyboardVerticalOffset={insets.top}
        >
          <View style={[styles.noteHeader, { borderColor: palette.line }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to files"
              onPress={closeNote}
              style={styles.backFolder}
            >
              <ArrowLeft size={21} color={palette.text} />
              <View style={styles.noteIdentity}>
                <Text numberOfLines={1} style={[styles.noteTitle, { color: palette.text }]}>
                  {parentFolder}
                </Text>
                <Text numberOfLines={1} style={[styles.noteStatus, { color: palette.muted }]}>
                  {note.draft
                    ? "Untitled · draft"
                    : note.path.split("/").pop()?.replace(/\.md$/i, "")}
                </Text>
              </View>
            </Pressable>
            <View style={[styles.segment, { backgroundColor: palette.raised }]}>
              {(["read", "edit"] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={value === "read" ? "Read note" : "Edit note"}
                  accessibilityState={{ selected: mode === value }}
                  onPress={() => setMode(value)}
                  style={[
                    styles.segmentButton,
                    mode === value && { backgroundColor: palette.surface },
                  ]}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      { color: mode === value ? palette.text : palette.muted },
                    ]}
                  >
                    {value === "read" ? "Read" : "Edit"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save note"
              disabled={busy}
              onPress={() => {
                leaveAfterSave.current = false;
                void save();
              }}
              style={styles.saveTextButton}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.accent} />
              ) : (
                <Text style={[styles.buttonText, { color: palette.accent }]}>Save</Text>
              )}
            </Pressable>
          </View>
          <View style={styles.root}>
            <DocumentSurface
              documentId={note.id}
              value={note.value}
              mode={mode}
              dark={dark}
              command={command}
              onChange={(value) => change(note.id, value)}
              onError={setStatus}
            />
          </View>
          <View style={[styles.statusStrip, { borderColor: palette.line }]}>
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.notice, { color: palette.muted }]}
              numberOfLines={2}
            >
              {note.draft ? `Draft · ${status}` : dirty(note) ? `Unsaved · ${status}` : status}
            </Text>
            <Text style={[styles.wordCount, { color: palette.muted }]}>
              {note.value.trim() ? note.value.trim().split(/\s+/).length : 0} words
            </Text>
          </View>
          {mode === "edit" && (
            <MarkdownToolbar
              dark={dark}
              onCommand={(action) => send(action)}
              onInsert={() => {
                insertOwner.current = note.id;
                insertPickerSequence.current++;
                setQuery("");
                setInsertCategory("All");
                setSelectedFile("");
                setInsertAs("embed");
                setDiagram(undefined);
                setSheet("insert");
              }}
            />
          )}
        </KeyboardAvoidingView>
      ) : (
        <FilesScreen
          entries={entries}
          recent={recent}
          name={
            connection?.kind === "github"
              ? connection.ref.repo
              : connection?.kind === "cloud"
                ? "My Grove"
                : "Sample vault"
          }
          status={status}
          busy={busy}
          dark={dark}
          onOpen={(path) => void openNote(path)}
          onNew={newNote}
          onSync={() => {
            if (lock()) void sync().catch(report).finally(unlock);
          }}
          onSettings={() => setSheet("settings")}
          onToggleTheme={() => setDark(!dark)}
        />
      )}
      <Modal
        visible={sheet !== null}
        animationType="slide"
        transparent
        onRequestClose={() => {
          if (!busy) {
            insertPickerSequence.current++;
            setSheet(null);
          }
        }}
      >
        <View style={styles.scrim}>
          <KeyboardAvoidingView behavior="padding" style={styles.sheetWrap}>
            <SafeAreaView
              style={[styles.sheet, { backgroundColor: palette.surface }]}
              edges={["bottom"]}
            >
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.sheetContent}
              >
                <View style={[styles.sheetHandle, { backgroundColor: palette.line }]} />
                <View style={styles.sheetHeading}>
                  <Text style={[styles.sheetTitle, { color: palette.text, flex: 1 }]}>
                    {sheet === "save" || sheet === "leave"
                      ? "Save note"
                      : sheet === "insert"
                        ? "Insert from vault"
                        : sheet === "conflict"
                          ? "Review both versions"
                          : "Settings"}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close sheet"
                    disabled={busy}
                    onPress={cancelSheet}
                    style={styles.closeSheet}
                  >
                    <X size={21} color={palette.muted} />
                  </Pressable>
                </View>
                {(sheet === "save" || sheet === "leave") && (
                  <Text style={[styles.description, { color: palette.muted }]}>
                    {leaveAfterSave.current
                      ? "Save this note before closing?"
                      : "Choose a name and folder for this note."}
                  </Text>
                )}
                {(sheet === "settings" ||
                  sheet === "conflict" ||
                  /failed|error|changed|unavailable|removed|no Mermaid|enter|already|denied/i.test(
                    status,
                  )) && (
                  <Text
                    accessibilityLiveRegion="polite"
                    style={[styles.description, { color: palette.muted }]}
                  >
                    {status}
                  </Text>
                )}
                {sheet === "settings" && (
                  <>
                    <Text selectable style={[styles.subheading, { color: palette.text }]}>
                      {connection?.kind === "github"
                        ? `${connection.ref.owner}/${connection.ref.repo} · ${connection.ref.branch}`
                        : connection?.kind === "cloud"
                          ? connection.email
                          : "Local sample vault"}
                    </Text>
                    <Text style={[styles.description, { color: palette.muted }]}>
                      Drafts and pending saves stay on this device when you sign out. Sign back in
                      to the same vault to resume.
                    </Text>
                    {button("Sign out / connect another vault", () => void signOut())}
                  </>
                )}
                {sheet === "leave" && (
                  <>
                    <Text style={[styles.description, { color: palette.text }]}>
                      Keep this note by saving it, discard this unfinished edit, or cancel to
                      continue writing.
                    </Text>
                    {button("Save", () => void save(), true)}
                    {button("Discard changes", () => void discard(), false, true)}
                  </>
                )}
                {sheet === "save" && (
                  <>
                    {field("File name", name, setName)}
                    <Text style={[styles.description, { color: palette.muted }]}>Folder</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose folder"
                      accessibilityState={{ expanded: chooseFolder }}
                      onPress={() => setChooseFolder(!chooseFolder)}
                      style={[
                        styles.folderField,
                        {
                          borderColor: palette.line,
                          backgroundColor: palette.background,
                        },
                      ]}
                    >
                      <Text style={[styles.folderText, { color: palette.text }]}>
                        {folder || "Vault root"}
                      </Text>
                      <ChevronDown size={18} color={palette.muted} />
                    </Pressable>
                    {chooseFolder && (
                      <View style={[styles.folderMenu, { borderColor: palette.line }]}>
                        {folders.map((path) => (
                          <Pressable
                            key={path}
                            accessibilityRole="button"
                            accessibilityState={{ selected: folder === path }}
                            onPress={() => {
                              setFolder(path);
                              setChooseFolder(false);
                            }}
                            style={styles.folderOption}
                          >
                            <Text
                              style={{
                                color: palette.text,
                                fontFamily: "Geist",
                              }}
                            >
                              {path || "Vault root"}
                            </Text>
                            {folder === path && <Check size={18} color={palette.accent} />}
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <Text style={[styles.pathPreview, { color: palette.muted }]}>
                      {[folder, name || "Untitled.md"].filter(Boolean).join("/")}
                    </Text>
                    {button("Save note", () => void save(true), true)}
                    {button("Cancel", cancelSheet)}
                    {button("Discard draft", () => void discard(), false, true)}
                  </>
                )}
                {sheet === "conflict" && conflict && (
                  <>
                    <Text style={[styles.description, { color: palette.text }]}>
                      A newer version exists. Keep both saves your edit as a separate conflict copy.
                    </Text>
                    <Text style={[styles.subheading, { color: palette.text }]}>Your edit</Text>
                    <Text
                      selectable
                      style={[
                        styles.code,
                        {
                          color: palette.text,
                          backgroundColor: palette.raised,
                        },
                      ]}
                    >
                      {note?.value}
                    </Text>
                    <Text style={[styles.subheading, { color: palette.text }]}>
                      {connection?.kind === "github"
                        ? "GitHub / device version"
                        : "Current saved version"}
                    </Text>
                    <Text
                      selectable
                      style={[
                        styles.code,
                        {
                          color: palette.text,
                          backgroundColor: palette.raised,
                        },
                      ]}
                    >
                      {conflict.content}
                    </Text>
                    {button("Keep both", () => void resolve("both"), true)}
                    {button("Keep mine", () => void resolve("mine"))}
                    {button(
                      connection?.kind === "github"
                        ? "Use GitHub / device version"
                        : "Use saved version",
                      () => void resolve("remote"),
                      false,
                      true,
                    )}
                  </>
                )}
                {sheet === "insert" && (
                  <>
                    <View style={[styles.vaultRow, { borderColor: palette.line }]}>
                      <SvgXml xml={groveSmall} width={28} height={28} />
                      <Text style={[styles.insertFileName, { color: palette.text }]}>
                        {connection?.kind === "github"
                          ? connection.ref.repo
                          : connection?.kind === "cloud"
                            ? "My Grove"
                            : "Sample vault"}
                      </Text>
                      <Text style={[styles.vaultRowHint, { color: palette.muted }]}>
                        Current vault
                      </Text>
                    </View>
                    <View style={[styles.insertSearch, { backgroundColor: palette.raised }]}>
                      <Search size={18} color={palette.muted} />
                      <TextInput
                        accessibilityLabel="Search saved files"
                        placeholder="Search vault files"
                        placeholderTextColor={palette.muted}
                        value={query}
                        onChangeText={setQuery}
                        editable={!busy}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={[styles.insertSearchInput, { color: palette.text }]}
                      />
                    </View>
                    <View style={[styles.categories, { borderColor: palette.line }]}>
                      {(["All", "Media", "Diagrams", "Charts"] as const).map((category) => (
                        <Pressable
                          key={category}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityState={{
                            selected: insertCategory === category,
                          }}
                          onPress={() => {
                            if (busyRef.current) return;
                            insertPickerSequence.current++;
                            setInsertCategory(category);
                            setSelectedFile("");
                            setDiagram(undefined);
                          }}
                          style={[
                            styles.category,
                            insertCategory === category && {
                              borderBottomColor: palette.accent,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              fontFamily: "Geist",
                              fontSize: 13,
                              color: insertCategory === category ? palette.accent : palette.muted,
                            }}
                          >
                            {category}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <ScrollView
                      style={styles.insertList}
                      nestedScrollEnabled
                      keyboardShouldPersistTaps="handled"
                    >
                      {(["Media", "Diagrams", "Charts", "Files"] as const).map((group) => {
                        const files = insertFiles.filter((entry) =>
                          group === "Media"
                            ? ["image", "audio", "video"].includes(entry.kind)
                            : group === "Diagrams"
                              ? entry.kind === "drawing"
                              : group === "Charts"
                                ? entry.kind === "markdown"
                                : !["image", "audio", "video", "drawing", "markdown"].includes(
                                    entry.kind,
                                  ),
                        );
                        return files.length ? (
                          <View key={group}>
                            <Text style={[styles.insertGroup, { color: palette.muted }]}>
                              {group}
                            </Text>
                            {files.map((entry) => (
                              <Pressable
                                key={entry.path}
                                accessibilityRole="button"
                                accessibilityLabel={`Select ${entry.path}`}
                                disabled={busy}
                                accessibilityState={{
                                  selected: selectedFile === entry.path,
                                }}
                                onPress={() => {
                                  if (busyRef.current) return;
                                  insertPickerSequence.current++;
                                  setSelectedFile(entry.path);
                                  setDiagram(undefined);
                                  setInsertAs(entry.kind === "markdown" ? "link" : "embed");
                                  if (entry.kind === "markdown") void findDiagram(entry.path);
                                }}
                                style={[
                                  styles.insertFile,
                                  {
                                    borderColor: palette.line,
                                    backgroundColor:
                                      selectedFile === entry.path
                                        ? palette.raised
                                        : palette.surface,
                                  },
                                ]}
                              >
                                <FileIcon path={entry.path} dark={dark} size={25} />
                                <View style={styles.insertFileText}>
                                  <Text
                                    numberOfLines={1}
                                    style={[styles.insertFileName, { color: palette.text }]}
                                  >
                                    {entry.name}
                                  </Text>
                                  <Text
                                    numberOfLines={1}
                                    style={[styles.insertFilePath, { color: palette.muted }]}
                                  >
                                    {entry.path.includes("/")
                                      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
                                      : "Vault root"}
                                  </Text>
                                </View>
                                {selectedFile === entry.path && (
                                  <Check size={19} color={palette.accent} />
                                )}
                              </Pressable>
                            ))}
                          </View>
                        ) : null;
                      })}
                      {!insertFiles.length && (
                        <Text style={[styles.description, { color: palette.muted }]}>
                          No saved files in this category.
                        </Text>
                      )}
                    </ScrollView>
                    {selectedFile && (
                      <View style={[styles.selectedSummary, { borderColor: palette.line }]}>
                        <Text
                          style={[styles.insertFileName, { color: palette.text }]}
                          numberOfLines={1}
                        >
                          {selectedFile.split("/").pop()}
                        </Text>
                        <Text style={[styles.insertFilePath, { color: palette.muted }]}>
                          {diagram
                            ? "Saved Mermaid block · reviewed snapshot"
                            : "Existing file · no duplicate created"}
                        </Text>
                      </View>
                    )}
                    {diagram && (
                      <>
                        {diagramChoices.length > 1 && (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={styles.choices}
                          >
                            {diagramChoices.map((choice) => (
                              <Pressable
                                key={choice.index}
                                disabled={busy}
                                accessibilityRole="button"
                                accessibilityState={{
                                  selected: diagram.index === choice.index,
                                }}
                                onPress={() => {
                                  if (busyRef.current) return;
                                  insertPickerSequence.current++;
                                  setDiagram(choice);
                                }}
                                style={[styles.blockChoice, { backgroundColor: palette.raised }]}
                              >
                                <Text
                                  style={{
                                    color: palette.text,
                                    fontFamily: "Geist",
                                    fontSize: 12,
                                  }}
                                >
                                  {choice.label}
                                </Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        )}
                        {insertAs === "embed" && (
                          <ScrollView style={styles.compactReview} nestedScrollEnabled>
                            <Text
                              selectable
                              style={[
                                styles.code,
                                {
                                  color: palette.text,
                                  backgroundColor: palette.raised,
                                },
                              ]}
                            >
                              {diagram.content}
                            </Text>
                          </ScrollView>
                        )}
                      </>
                    )}
                    <View style={styles.insertOptions}>
                      {(selectedFile && kindOf(selectedFile) === "markdown" && !diagram
                        ? (["link"] as const)
                        : (["embed", "link"] as const)
                      ).map((value) => (
                        <Pressable
                          key={value}
                          disabled={busy}
                          accessibilityRole="button"
                          accessibilityState={{ selected: insertAs === value }}
                          accessibilityLabel={
                            value === "embed"
                              ? diagram
                                ? "Insert editable source"
                                : "Insert as embed"
                              : "Insert as link"
                          }
                          onPress={() => {
                            if (busyRef.current) return;
                            insertPickerSequence.current++;
                            setInsertAs(value);
                          }}
                          style={[
                            styles.insertOption,
                            {
                              borderColor: insertAs === value ? palette.accent : palette.line,
                              backgroundColor:
                                insertAs === value ? palette.raised : palette.surface,
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.radio,
                              {
                                borderColor: insertAs === value ? palette.accent : palette.muted,
                              },
                            ]}
                          >
                            {insertAs === value && (
                              <View
                                style={[styles.radioDot, { backgroundColor: palette.accent }]}
                              />
                            )}
                          </View>
                          <Text
                            style={{
                              color: palette.text,
                              fontFamily: "Geist",
                              fontSize: 13,
                            }}
                          >
                            {value === "embed" ? (diagram ? "Editable source" : "Embed") : "Link"}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                    <View style={styles.insertFooter}>
                      <View style={styles.footerCancel}>{button("Cancel", cancelSheet)}</View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Insert selected file"
                        disabled={!selectedFile || busy}
                        onPress={() => {
                          if (diagram && insertAs === "embed") void addDiagram();
                          else insert(selectedFile, insertAs === "embed");
                        }}
                        style={[
                          styles.button,
                          styles.footerInsert,
                          {
                            backgroundColor: palette.accent,
                            opacity: !selectedFile || busy ? 0.45 : 1,
                          },
                        ]}
                      >
                        <Text style={[styles.buttonText, { color: dark ? "#032b20" : "#ffffff" }]}>
                          Insert
                        </Text>
                      </Pressable>
                    </View>
                  </>
                )}
                {sheet !== "save" && sheet !== "insert" && button("Cancel", cancelSheet)}
              </ScrollView>
            </SafeAreaView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SignIn({
  dark,
  busy,
  status,
  onConnect,
  onSample,
  onStatus,
}: {
  dark: boolean;
  busy: boolean;
  status: string;
  onConnect: (value: MobileConnection) => void;
  onSample: () => void;
  onStatus: (value: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const palette = theme(dark);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [owner, setOwner] = useState(""),
    [repo, setRepo] = useState(""),
    [branch, setBranch] = useState("main"),
    [token, setToken] = useState("");
  const [working, setWorking] = useState(false);
  const [captcha, setCaptcha] = useState("");
  const [attempt, setAttempt] = useState(0);
  const workingRef = useRef(false);
  const run = async (operation: () => Promise<void>) => {
    if (workingRef.current || busy) return;
    workingRef.current = true;
    setWorking(true);
    try {
      await operation();
    } catch (error) {
      onStatus(message(error));
    } finally {
      workingRef.current = false;
      setWorking(false);
    }
  };
  const emailAttempt = (create = false) =>
    void run(async () => {
      if (!captchaUrl || !captcha) throw new Error("Complete account verification first.");
      try {
        const value = await signInEmail(email, password, create, captcha);
        if (value) onConnect(value);
        else onStatus("Check your email to confirm your Grove account.");
      } finally {
        setCaptcha("");
        setAttempt((value) => value + 1);
      }
    });
  const button = (label: string, action: () => void, primary = false, blocked = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy || working || blocked}
      accessibilityState={{ disabled: busy || working || blocked }}
      onPress={action}
      style={[
        styles.button,
        {
          backgroundColor: primary ? palette.accent : palette.raised,
          opacity: busy || working || blocked ? 0.6 : 1,
        },
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          { color: primary ? (dark ? "#032b20" : "#ffffff") : palette.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
  const field = (label: string, value: string, update: (value: string) => void, secret = false) => (
    <TextInput
      accessibilityLabel={label}
      placeholder={label}
      placeholderTextColor={palette.muted}
      value={value}
      onChangeText={update}
      secureTextEntry={secret}
      autoCapitalize="none"
      autoCorrect={false}
      editable={!working && !busy}
      style={[
        styles.input,
        {
          color: palette.text,
          borderColor: palette.line,
          backgroundColor: palette.surface,
        },
      ]}
    />
  );
  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior="padding"
      keyboardVerticalOffset={insets.top}
    >
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.signIn}>
        <Text style={[styles.brand, { color: palette.accent }]}>Grove</Text>
        <Text style={[styles.tagline, { color: palette.text }]}>A quieter place to think.</Text>
        <Text
          accessibilityLiveRegion="polite"
          style={[styles.description, { color: palette.muted }]}
        >
          {status}
        </Text>
        {accounts ? (
          <>
            {button(
              "Continue with GitHub",
              () => void run(async () => onConnect(await signInGitHub())),
              true,
            )}
            {field("Email", email, setEmail)}
            {field("Password", password, setPassword, true)}
            {captchaUrl ? (
              <Captcha url={captchaUrl} attempt={attempt} dark={dark} onToken={setCaptcha} />
            ) : (
              <Text style={[styles.description, { color: palette.muted }]}>
                Email sign-in needs the Grove verification page configured in this build.
              </Text>
            )}
            {button("Sign in with email", () => emailAttempt(), false, !captcha)}
            {button("Create account", () => emailAttempt(true), false, !captcha)}
            {button(
              "Forgot password?",
              () =>
                void run(async () => {
                  await resetPassword(email);
                  onStatus("Manage your password in the browser.");
                }),
            )}
          </>
        ) : (
          <Text style={[styles.description, { color: palette.muted }]}>
            Account sign-in is not configured in this build. Connect a GitHub repository or try the
            local sample.
          </Text>
        )}
        <Text style={[styles.subheading, { color: palette.text }]}>
          Connect a GitHub repository
        </Text>
        <Text style={[styles.description, { color: palette.muted }]}>
          Use a fine-grained token with Contents read and write access to this repository.{" "}
          {Platform.OS === "web"
            ? "The preview keeps credentials in memory until reload."
            : "Credentials are stored securely on this device."}
        </Text>
        {field("Repository owner", owner, setOwner)}
        {field("Repository name", repo, setRepo)}
        {field("Branch", branch, setBranch)}
        {field("Repository token", token, setToken, true)}
        {button(
          "Connect repository",
          () => {
            if (!owner.trim() || !repo.trim() || !branch.trim() || !token.trim()) {
              onStatus("Enter an owner, repository, branch and token.");
              return;
            }
            onConnect({
              kind: "github",
              ref: {
                owner: owner.trim(),
                repo: repo.trim(),
                branch: branch.trim(),
              },
              token: token.trim(),
            });
          },
          true,
        )}
        {button("Try sample vault", onSample)}
        <Text style={[styles.description, { color: palette.muted }]}>
          The sample is local to this device. It does not connect to a personal vault.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  noteHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    minHeight: 64,
    borderBottomWidth: 1,
  },
  icon: {
    minWidth: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  backFolder: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  noteIdentity: { flex: 1, minWidth: 0, paddingHorizontal: 3 },
  segment: { flexDirection: "row", borderRadius: 9, padding: 3 },
  segmentButton: {
    minWidth: 46,
    minHeight: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 7,
  },
  segmentText: { fontFamily: "Geist", fontSize: 13 },
  saveTextButton: {
    minWidth: 55,
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  statusStrip: {
    minHeight: 36,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 14,
  },
  wordCount: { fontFamily: "Geist", fontSize: 10, flexShrink: 0 },
  noteTitle: { fontFamily: "Geist", fontSize: 17, fontWeight: "600" },
  noteStatus: {
    fontFamily: "Geist",
    fontSize: 10,
    marginTop: 3,
    lineHeight: 14,
  },
  notice: {
    flex: 1,
    fontFamily: "Geist",
    fontSize: 10,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  button: {
    minHeight: 46,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginVertical: 4,
  },
  buttonText: { fontFamily: "Geist", fontSize: 15, fontWeight: "500" },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontFamily: "Geist",
    fontSize: 16,
    marginVertical: 4,
  },
  field: { gap: 4, marginVertical: 6 },
  scrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheetWrap: { maxHeight: "90%" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: "hidden",
  },
  sheetContent: { padding: 22, paddingTop: 10, gap: 6 },
  sheetHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  closeSheet: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  vaultRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderBottomWidth: 1,
    marginBottom: 8,
  },
  vaultBadge: {
    width: 26,
    height: 26,
    borderRadius: 7,
    textAlign: "center",
    lineHeight: 26,
    fontFamily: "SourceSerif",
    fontSize: 19,
  },
  vaultRowHint: { marginLeft: "auto", fontFamily: "Geist", fontSize: 10 },
  insertSearch: {
    flexDirection: "row",
    minHeight: 44,
    borderRadius: 9,
    paddingHorizontal: 12,
    alignItems: "center",
    gap: 8,
  },
  insertSearchInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: "Geist",
    fontSize: 14,
  },
  insertGroup: {
    fontFamily: "Geist",
    fontSize: 11,
    marginTop: 12,
    marginBottom: 3,
    fontWeight: "600",
  },
  selectedSummary: { borderTopWidth: 1, paddingTop: 12, marginTop: 6, gap: 3 },
  compactReview: { maxHeight: 100 },
  blockChoice: {
    minHeight: 44,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 8, height: 8, borderRadius: 4 },
  insertFooter: { flexDirection: "row", gap: 10, alignItems: "center" },
  footerCancel: { flex: 1 },
  footerInsert: { flex: 1 },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 3,
    alignSelf: "center",
    marginBottom: 12,
  },
  folderField: {
    borderWidth: 1,
    borderRadius: 9,
    minHeight: 48,
    paddingHorizontal: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  folderText: { flex: 1, fontFamily: "Geist", fontSize: 15 },
  folderMenu: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12 },
  folderOption: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pathPreview: {
    fontFamily: "JetBrainsMono",
    fontSize: 11,
    marginVertical: 10,
  },
  categories: { flexDirection: "row", borderBottomWidth: 1 },
  category: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  insertList: { maxHeight: 220, minHeight: 100 },
  insertFile: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    gap: 12,
    borderBottomWidth: 1,
  },
  insertFileText: { flex: 1, minWidth: 0 },
  insertFileName: { fontFamily: "Geist", fontSize: 14 },
  insertFilePath: { fontFamily: "Geist", fontSize: 11, marginTop: 3 },
  insertOptions: { flexDirection: "row", gap: 10, marginVertical: 4 },
  insertOption: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontFamily: "Geist",
    fontSize: 23,
    fontWeight: "600",
    marginBottom: 6,
  },
  description: {
    fontFamily: "Geist",
    fontSize: 13,
    lineHeight: 20,
    marginVertical: 6,
  },
  subheading: {
    fontFamily: "Geist",
    fontSize: 15,
    fontWeight: "600",
    marginTop: 14,
    marginBottom: 6,
  },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  folder: { minHeight: 44, padding: 12, borderRadius: 9 },
  code: {
    fontFamily: "JetBrainsMono",
    fontSize: 12,
    lineHeight: 19,
    padding: 12,
    borderRadius: 8,
  },
  insertRow: { borderBottomWidth: 1, paddingBottom: 10 },
  signIn: { padding: 26, gap: 6, paddingBottom: 44 },
  brand: {
    fontFamily: "Geist",
    fontSize: 34,
    fontWeight: "600",
    marginTop: 24,
  },
  tagline: { fontFamily: "SourceSerif", fontSize: 25, marginBottom: 12 },
});
