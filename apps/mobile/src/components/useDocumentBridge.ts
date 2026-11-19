import { useCallback, useEffect, useRef } from "react";
import {
  validateCommand,
  validateEditorMessage,
  validText,
  type HostMessage,
} from "../../editor/protocol";
import { SourceAcknowledgements } from "./source-acknowledgements";
import type { DocumentSurfaceProps } from "./DocumentSurface.types";

function newSession() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
/** One hook instance belongs to exactly one keyed document surface. */
export function useDocumentBridge(props: DocumentSurfaceProps, deliver: (message: string) => void) {
  const latest = useRef(props);
  latest.current = props;
  const transport = useRef(deliver);
  transport.current = deliver;
  const identity = useRef({
    documentId: props.documentId,
    session: newSession(),
  });
  const revision = useRef(0);
  const ready = useRef(false);
  const alive = useRef(true);
  const editorValue = useRef(props.value);
  const lastCommand = useRef(-1);
  const pendingChange = useRef(false);
  const acknowledgements = useRef(new SourceAcknowledgements(props.value));
  const send = useCallback(
    (message: HostMessage) => transport.current(JSON.stringify(message)),
    [],
  );
  const sendCommand = useCallback(() => {
    const command = latest.current.command;
    if (!ready.current || !command || command.id <= lastCommand.current) return;
    if (!validateCommand(command)) {
      latest.current.onError?.("This editor command is invalid or too large.");
      return;
    }
    lastCommand.current = command.id;
    send({ type: "command", ...identity.current, command });
  }, [send]);
  const emitLatestChange = useCallback(() => {
    if (!pendingChange.current || acknowledgements.current.needsAcknowledgement) return;
    pendingChange.current = false;
    acknowledgements.current.record(editorValue.current);
    latest.current.onChange(editorValue.current);
  }, []);
  const synchronizeSource = useCallback(() => {
    const value = latest.current.value;
    if (!ready.current) return;
    const external = acknowledgements.current.isExternal(value);
    if (!external || value === editorValue.current) {
      emitLatestChange();
      return;
    }
    pendingChange.current = false;
    if (!validText(value)) {
      latest.current.onError?.("This note is too large for the phone editor.");
      return;
    }
    const previous = identity.current;
    const nextSession = newSession();
    identity.current = { ...previous, session: nextSession };
    revision.current = 0;
    ready.current = false;
    editorValue.current = value;
    send({ type: "replace", ...previous, value, nextSession, revision: 0 });
  }, [send, emitLatestChange]);
  const receive = useCallback(
    (raw: unknown) => {
      if (!alive.current) return;
      const message = validateEditorMessage(raw, {
        ...identity.current,
        revision: revision.current,
      });
      if (!message) return;
      if (message.type === "boot") {
        const current = latest.current;
        if (!validText(current.value)) {
          current.onError?.("This note is too large for the phone editor.");
          return;
        }
        // A reloaded WebView gets the last shell-owned source, never credentials.
        ready.current = false;
        editorValue.current = current.value;
        send({
          type: "initialize",
          ...identity.current,
          revision: revision.current,
          value: current.value,
          mode: current.mode,
          dark: current.dark,
        });
      } else if (message.type === "ready") {
        const first = !ready.current;
        ready.current = true;
        if (first) latest.current.onReady?.();
        synchronizeSource();
        if (ready.current)
          send({
            type: "appearance",
            ...identity.current,
            mode: latest.current.mode,
            dark: latest.current.dark,
          });
        sendCommand();
      } else if (message.type === "change" && ready.current) {
        revision.current = message.revision;
        editorValue.current = message.value;
        pendingChange.current = true;
        emitLatestChange();
      } else if (message.type === "error") latest.current.onError?.(message.message);
    },
    [send, sendCommand, synchronizeSource, emitLatestChange],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      ready.current = false;
    };
  }, []);
  // The shell also renders when edits return to the same source (type then undo).
  // Acknowledge that render even when the string itself did not change.
  useEffect(synchronizeSource);
  useEffect(() => {
    if (ready.current)
      send({
        type: "appearance",
        ...identity.current,
        mode: props.mode,
        dark: props.dark,
      });
  }, [props.mode, props.dark, send]);
  useEffect(sendCommand, [props.command, sendCommand]);
  const probe = useCallback(() => send({ type: "probe" }), [send]);
  return { receive, probe };
}
