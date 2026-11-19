import { StateEffect, StateField } from "@codemirror/state";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { MarkdownAction } from "../shared/markdown-format";

export type LiveKind = "code" | "markdown" | "media" | "properties" | "html";
export type LiveOptions = {
  dark: boolean;
  render: (
    dom: HTMLElement,
    source: string,
    kind: LiveKind,
    reveal: () => void,
    change: (value: string) => void,
  ) => () => void;
  open: (target: string) => void;
  notify?: (message: string) => void;
  format?: (action: MarkdownAction) => boolean;
  undo?: () => boolean;
  redo?: () => boolean;
  sourceFocus?: () => void;
  canUndo?: () => boolean | undefined;
  canRedo?: () => boolean | undefined;
};
export const refreshLivePreview = StateEffect.define<null>();
const focusLive = StateEffect.define<boolean>();
const focused = StateField.define<boolean>({
  create: () => false,
  update: (value, tr) =>
    tr.effects.find((effect) => effect.is(focusLive))?.value ?? (tr.selection ? true : value),
});
const widgets = new WeakMap<
  HTMLElement,
  {
    reveal: (event?: MouseEvent) => void;
    dispose: () => void;
    observer?: ResizeObserver;
    identity: object;
    acknowledged: { source: string };
  }
>();

function active(state: EditorState, from: number, to: number) {
  if (!state.field(focused, false)) return false;
  const first = state.doc.lineAt(from).from,
    last = state.doc.lineAt(to).to;
  return state.selection.ranges.some((range) => range.from <= last && range.to >= first);
}
function editingMarker(state: EditorState, from: number, to: number) {
  return (
    state.field(focused, false) &&
    state.selection.ranges.some((range) =>
      range.empty ? range.head >= from && range.head < to : range.from < to && range.to > from,
    )
  );
}
class PreviewWidget extends WidgetType {
  readonly dark: boolean;
  constructor(
    readonly source: string,
    readonly kind: LiveKind,
    readonly block: boolean,
    readonly options: LiveOptions,
    readonly identity: object,
  ) {
    super();
    this.dark = options.dark;
  }
  eq(other: PreviewWidget) {
    return (
      this.source === other.source &&
      this.identity === other.identity &&
      this.kind === other.kind &&
      this.block === other.block &&
      this.dark === other.dark &&
      this.options === other.options
    );
  }
  position(dom: HTMLElement, view: EditorView, expected = this.source) {
    try {
      if (widgets.has(dom) && view.dom.isConnected && view.contentDOM.contains(dom)) {
        const from = view.posAtDOM(dom);
        if (view.state.doc.sliceString(from, from + expected.length) === expected) return from;
      }
    } catch {
      /* A detached widget cannot write to its former range. */
    }
    this.options.notify?.("This preview changed. Move the cursor into its source to edit it.");
    return null;
  }
  render(dom: HTMLElement, view: EditorView) {
    const previous = widgets.get(dom);
    const acknowledged =
      previous?.identity === this.identity && previous.acknowledged.source === this.source
        ? previous.acknowledged
        : { source: this.source };
    const reveal = (event?: MouseEvent) => {
      if (widgets.get(dom)?.acknowledged !== acknowledged) return;
      const from = this.position(dom, view, acknowledged.source);
      if (from === null) return;
      view.dispatch({ selection: { anchor: from } });
      view.focus();
      if (event) {
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position !== null)
          view.dispatch({
            selection: { anchor: Math.max(from, Math.min(from + this.source.length, position)) },
          });
      }
    };
    const dispose = this.options.render(
      dom,
      this.source,
      this.kind,
      () => reveal(),
      (value) => {
        if (widgets.get(dom)?.acknowledged !== acknowledged) {
          this.options.notify?.("This preview changed. Open its source again before editing.");
          return;
        }
        const from = this.position(dom, view, acknowledged.source);
        if (from !== null) {
          const to = from + acknowledged.source.length;
          acknowledged.source = value;
          view.dispatch({
            changes: { from, to, insert: value },
            userEvent: "input.live-preview",
          });
        }
      },
    );
    widgets.set(dom, {
      reveal,
      dispose,
      observer: previous?.observer,
      identity: this.identity,
      acknowledged,
    });
  }
  toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("div");
    dom.contentEditable = "false";
    dom.className = `cm-live-widget ${this.block ? "block" : "inline"}`;
    this.render(dom, view);
    const observer = new ResizeObserver(() => {
      if (view.dom.isConnected) view.requestMeasure();
    });
    observer.observe(dom);
    dom.addEventListener("mousedown", (event) => {
      const nested =
        event.target instanceof Element ? event.target.closest('[contenteditable="true"]') : null;
      if (
        event.button === 0 &&
        (!nested || !dom.contains(nested)) &&
        event.target instanceof Element &&
        event.target.closest("button")
      )
        event.preventDefault();
      if (
        event.button !== 0 ||
        (nested && dom.contains(nested)) ||
        (event.target instanceof Element &&
          event.target.closest("button,input,a,summary,video,audio,canvas,svg"))
      )
        return;
      event.preventDefault();
      widgets.get(dom)?.reveal(event);
    });
    widgets.get(dom)!.observer = observer;
    return dom;
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    if (
      dom.classList.contains("block") !== this.block ||
      widgets.get(dom)?.identity !== this.identity
    )
      return false;
    // The renderer owns the React root and updates it in place.
    this.render(dom, view);
    return true;
  }
  destroy(dom: HTMLElement) {
    const record = widgets.get(dom);
    widgets.delete(dom);
    record?.observer?.disconnect();
    if (record) queueMicrotask(record.dispose);
  }
}
class Bullet extends WidgetType {
  toDOM(view: EditorView) {
    const dom = view.dom.ownerDocument.createElement("span");
    dom.textContent = "• ";
    dom.className = "cm-live-bullet";
    return dom;
  }
  eq() {
    return true;
  }
  ignoreEvent() {
    return false;
  }
}
class Task extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: Task) {
    return this.checked === other.checked;
  }
  toDOM(view: EditorView) {
    const input = view.dom.ownerDocument.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.className = "cm-live-task";
    input.setAttribute("aria-label", this.checked ? "Mark task incomplete" : "Complete task");
    input.addEventListener("mousedown", (event) => event.preventDefault());
    input.addEventListener("change", () => {
      const from = view.posAtDOM(input),
        raw = view.state.doc.sliceString(from, from + 3);
      if (/^\[[ xX]\]$/.test(raw))
        view.dispatch({
          changes: { from, to: from + 3, insert: input.checked ? "[x]" : "[ ]" },
          userEvent: "input.live-task",
        });
    });
    return input;
  }
}

function decorations(
  state: EditorState,
  options: LiveOptions,
  previous = new Map<number, PreviewWidget>(),
): DecorationSet {
  const ranges: Range<Decoration>[] = [],
    tree = syntaxTree(state),
    text = state.doc.toString();
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(Decoration.replace({ liveHidden: true }).range(from, to));
  };
  const mark = (from: number, to: number, name: string, attributes?: Record<string, string>) => {
    if (to > from) ranges.push(Decoration.mark({ class: name, attributes }).range(from, to));
  };
  const widget = (from: number, to: number, kind: LiveKind, block = true) =>
    ranges.push(
      Decoration.replace({
        widget: new PreviewWidget(
          text.slice(from, to),
          kind,
          block,
          options,
          previous.get(from)?.kind === kind ? previous.get(from)!.identity : {},
        ),
        block,
        liveHidden: true,
      }).range(from, to),
    );
  let propertiesEnd = 0;
  const first = state.doc.line(1).text.replace(/^\uFEFF/, "");
  if (first === "---" || first === "+++")
    for (let line = 2; line <= state.doc.lines; line++) {
      if (state.doc.line(line).text === first) {
        propertiesEnd = state.doc.line(line).to;
        break;
      }
    }
  if (propertiesEnd && !active(state, 0, propertiesEnd)) widget(0, propertiesEnd, "properties");
  const wiki: { from: number; to: number }[] = [];
  for (const match of text.matchAll(/!?\[\[[^\]\n]+\]\]/g)) {
    const from = match.index!,
      to = from + match[0].length;
    let escaped = 0;
    for (let at = from - 1; at >= 0 && text[at] === "\\"; at--) escaped++;
    if (escaped % 2 || from < propertiesEnd) continue;
    let node = tree.resolveInner(from, 1),
      literal = false;
    for (let parent: typeof node | null = node; parent; parent = parent.parent)
      if (
        [
          "FencedCode",
          "CodeBlock",
          "InlineCode",
          "HTMLBlock",
          "URL",
          "LinkTitle",
          "Table",
          "SetextHeading1",
          "SetextHeading2",
        ].includes(parent.name)
      )
        literal = true;
    if (literal) continue;
    wiki.push({ from, to });
    if (active(state, from, to)) continue;
    if (match[0].startsWith("!")) widget(from, to, "media", false);
    else {
      const pipe = match[0].indexOf("|");
      hide(from, from + (pipe >= 0 ? pipe + 1 : 2));
      hide(to - 2, to);
      mark(from, to, "cm-live-link", { "data-live-target": match[0].slice(2, -2).split("|")[0] });
    }
  }
  const quoted = new Set<number>();
  tree.iterate({
    enter(node) {
      if (node.name === "Document") return;
      if (
        node.from < propertiesEnd ||
        wiki.some((range) => node.from >= range.from && node.to <= range.to)
      )
        return false;
      const selected = active(state, node.from, node.to);
      const complex: Record<string, LiveKind> = {
        FencedCode: "code",
        CodeBlock: "code",
        Table: "markdown",
        HTMLBlock: "html",
        HorizontalRule: "markdown",
        SetextHeading1: "markdown",
        SetextHeading2: "markdown",
      };
      if (complex[node.name]) {
        if (!selected) widget(node.from, node.to, complex[node.name]);
        return false;
      }
      if (node.name === "Image") {
        if (!selected) widget(node.from, node.to, "media", false);
        return false;
      }
      if (/^ATXHeading[1-6]$/.test(node.name))
        ranges.push(
          Decoration.line({ class: `cm-live-h${node.name.at(-1)}` }).range(
            state.doc.lineAt(node.from).from,
          ),
        );
      if (node.name === "StrongEmphasis") mark(node.from, node.to, "cm-live-strong");
      if (node.name === "Emphasis") mark(node.from, node.to, "cm-live-em");
      if (node.name === "Strikethrough") mark(node.from, node.to, "cm-live-strike");
      if (node.name === "InlineCode") {
        mark(node.from, node.to, "cm-live-code");
        if (!selected)
          for (const token of node.node.getChildren("CodeMark")) hide(token.from, token.to);
        return false;
      }
      if (node.name === "Link") {
        const tokens = node.node.getChildren("LinkMark"),
          close = tokens.find((token) => text.slice(token.from, token.to) === "]");
        const url = node.node.getChild("URL");
        if (close && url) {
          mark(node.from, close.from, "cm-live-link", {
            "data-live-target": text.slice(url.from, url.to),
          });
          if (!selected) {
            hide(node.from, tokens[0].to);
            hide(close.from, node.to);
          }
        }
        return;
      }
      if (node.name === "QuoteMark") {
        const line = state.doc.lineAt(node.from);
        if (!quoted.has(line.from)) {
          ranges.push(Decoration.line({ class: "cm-live-quote" }).range(line.from));
          quoted.add(line.from);
        }
        if (!selected) hide(node.from, node.to + (text[node.to] === " " ? 1 : 0));
      }
      if (!selected && ["HeaderMark", "EmphasisMark", "StrikethroughMark"].includes(node.name))
        hide(node.from, node.to + (node.name === "HeaderMark" && text[node.to] === " " ? 1 : 0));
      if (!selected && node.name === "Escape") hide(node.from, node.from + 1);
      if (node.name === "ListMark" && text[node.from].match(/[-+*]/)) {
        const end = node.to + (text[node.to] === " " ? 1 : 0);
        const task = node.node.parent?.getChild("Task")?.getChild("TaskMarker");
        if (task) {
          if (!editingMarker(state, node.from, task.to)) hide(node.from, end);
        } else if (!selected)
          ranges.push(
            Decoration.replace({ widget: new Bullet(), liveHidden: true }).range(node.from, end),
          );
      }
      if (
        node.name === "TaskMarker" &&
        !editingMarker(
          state,
          node.node.parent?.parent?.getChild("ListMark")?.from ?? node.from,
          node.to,
        )
      )
        ranges.push(
          Decoration.replace({
            widget: new Task(/[xX]/.test(text.slice(node.from, node.to))),
            liveHidden: true,
          }).range(node.from, node.to),
        );
    },
  });
  return Decoration.set(ranges, true);
}

export function livePreview(options: LiveOptions) {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorations(state, options),
    update: (value, tr) => {
      if (
        !(
          tr.docChanged ||
          tr.selection ||
          syntaxTree(tr.state) !== syntaxTree(tr.startState) ||
          tr.effects.some((effect) => effect.is(refreshLivePreview) || effect.is(focusLive))
        )
      )
        return value;
      const previous = new Map<number, PreviewWidget>();
      value.between(0, tr.startState.doc.length, (from, to, decoration) => {
        const widget = decoration.spec.widget;
        if (!(widget instanceof PreviewWidget)) return;
        let replaced = false;
        tr.changes.iterChangedRanges((start, end) => {
          if (start < to && end > from && (start < from || end > to)) replaced = true;
        });
        const nextFrom = tr.changes.mapPos(from, -1),
          nextTo = tr.changes.mapPos(to, 1);
        if (!replaced && nextTo > nextFrom) previous.set(nextFrom, widget);
      });
      return decorations(tr.state, options, previous);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    focused,
    field,
    EditorView.domEventHandlers({
      focus(_event, view) {
        if (view.hasFocus) options.sourceFocus?.();
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: focusLive.of(view.hasFocus) });
        });
        return false;
      },
      blur(_event, view) {
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: focusLive.of(view.hasFocus) });
        });
        return false;
      },
      click(event) {
        if (!(event.ctrlKey || event.metaKey) || !(event.target instanceof Element)) return false;
        const target = event.target.closest<HTMLElement>("[data-live-target]")?.dataset.liveTarget;
        if (!target) return false;
        event.preventDefault();
        options.open(target);
        return true;
      },
    }),
  ];
}
