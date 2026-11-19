import { useCallback, useRef, useState } from "react";
import * as Menu from "@radix-ui/react-menu";
import { ChevronRight } from "lucide-react";
import { overlayContainer } from "./Overlay";

export type MenuPoint = { x: number; y: number };
export function useItemMenu(snapshot: () => unknown = () => null) {
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [state, setState] = useState<{
    point: MenuPoint;
    snapshot: unknown;
  } | null>(null);
  const close = useCallback(() => setState(null), []);
  const open = (event: React.MouseEvent | MouseEvent) => {
    const nested =
      event.target instanceof Element ? event.target.closest(".cm-editor,.tiptap") : null;
    if (
      event.defaultPrevented ||
      (nested &&
        nested !== event.currentTarget &&
        event.currentTarget instanceof Element &&
        event.currentTarget.contains(nested))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    setState({
      point: { x: event.clientX, y: event.clientY },
      snapshot: latest.current(),
    });
  };
  return {
    point: state?.point ?? null,
    open,
    close,
    isCurrent: () => !!state && state.snapshot === latest.current(),
  };
}
export function ItemMenu({
  point,
  close,
  label = "Item actions",
  children,
}: {
  point: MenuPoint;
  close: () => void;
  label?: string;
  children: React.ReactNode;
}) {
  const previous = useRef(document.activeElement);
  const anchor = useRef({
    getBoundingClientRect: () => new DOMRect(point.x, point.y, 0, 0),
  });
  anchor.current.getBoundingClientRect = () => new DOMRect(point.x, point.y, 0, 0);
  return (
    <Menu.Root
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      modal={false}
    >
      <Menu.Anchor virtualRef={anchor} />
      <Menu.Portal container={overlayContainer()}>
        <Menu.Content
          className="menu file-context-menu item-menu"
          aria-label={label}
          side="right"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          loop
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const active = document.activeElement;
            if (
              previous.current instanceof HTMLElement &&
              previous.current.isConnected &&
              active === document.body &&
              !document.querySelector('[data-radix-dialog-content][data-state="open"]')
            )
              previous.current.focus();
          }}
        >
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
export function ItemMenuItem(props: React.ComponentPropsWithoutRef<"button">) {
  return (
    <Menu.Item asChild disabled={props.disabled}>
      <button type="button" {...props} />
    </Menu.Item>
  );
}
export function ItemSubmenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Menu.Sub open={open} onOpenChange={setOpen}>
      <Menu.SubTrigger className="item-submenu-trigger">
        {label}
        <ChevronRight aria-hidden="true" />
      </Menu.SubTrigger>
      <Menu.Portal container={overlayContainer()}>
        <Menu.SubContent
          className="menu file-context-menu item-menu"
          sideOffset={3}
          alignOffset={-6}
          collisionPadding={8}
          loop
        >
          {children}
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}
