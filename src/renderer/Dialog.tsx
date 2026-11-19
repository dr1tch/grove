import { forwardRef, useRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { Dialog as Primitive } from "radix-ui";
import "./radix-dialog.css";

type Props = Omit<ComponentPropsWithoutRef<typeof Primitive.Content>, "title"> & {
  label: string;
  close: () => void;
  dismissible?: boolean;
};

/** The caller mounts the dialog while open and keeps ownership of save/dismiss guards. */
export const Dialog = forwardRef<HTMLDivElement, Props>(function Dialog(
  { label, close, dismissible = true, children, ...props },
  ref,
) {
  const opener = useRef(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const content = useRef<HTMLDivElement | null>(null);
  return (
    <Primitive.Root
      open
      onOpenChange={(open) => {
        if (!open && dismissible) close();
      }}
    >
      <Primitive.Portal container={document.fullscreenElement ?? document.body}>
        <Primitive.Overlay className="modal-backdrop radix-dialog-backdrop" />
        <Primitive.Content
          {...props}
          ref={(node) => {
            content.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          className={`radix-dialog-content ${props.className || ""}`}
          data-radix-dialog-content=""
          aria-label={label}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            props.onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            event.preventDefault();
            // Mounted dialogs have no Radix Trigger. Restore only when no newer overlay took focus.
            const active = document.activeElement;
            if (
              opener.current?.isConnected &&
              (!active || active === document.body || content.current?.contains(active))
            )
              opener.current.focus();
          }}
          onEscapeKeyDown={(event) => {
            props.onEscapeKeyDown?.(event);
            if (!dismissible) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            props.onInteractOutside?.(event);
            if (!dismissible) event.preventDefault();
          }}
        >
          <Primitive.Title className="radix-dialog-title">{label}</Primitive.Title>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
});
