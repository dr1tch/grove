import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useEffect,
  type ReactElement,
  type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
export function Tooltip({
  text,
  children,
}: {
  text: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const popup = useRef<HTMLDivElement>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = () => clearTimeout(delay.current);
  const close = () => {
    cancel();
    setOpen(false);
  };
  const leave = () => {
    cancel();
    delay.current = setTimeout(() => setOpen(false), 120);
  };
  useEffect(() => () => clearTimeout(delay.current), []);
  useLayoutEffect(() => {
    if (!open || !popup.current || !trigger.current) return;
    const tip = popup.current;
    tip.showPopover();
    const anchor = trigger.current.getBoundingClientRect();
    tip.style.maxHeight = "calc(100vh - 16px)";
    const box = tip.getBoundingClientRect();
    const gap = 8;
    const above = anchor.top - gap * 2;
    const below = innerHeight - anchor.bottom - gap * 2;
    const right = innerWidth - anchor.right - gap * 2;
    const leftSpace = anchor.left - gap * 2;
    let left = anchor.left + (anchor.width - box.width) / 2;
    let top: number;
    if (box.height <= above) top = anchor.top - box.height - gap;
    else if (box.height <= below) top = anchor.bottom + gap;
    else if (box.width <= Math.max(right, leftSpace)) {
      left = box.width <= right ? anchor.right + gap : anchor.left - box.width - gap;
      top = anchor.top + (anchor.height - box.height) / 2;
    } else {
      const height = Math.max(1, Math.max(above, below));
      tip.style.maxHeight = `${height}px`;
      top = above >= below ? anchor.top - height - gap : anchor.bottom + gap;
    }
    tip.style.left = `${Math.max(8, Math.min(left, innerWidth - box.width - 8))}px`;
    tip.style.top = `${Math.max(8, Math.min(top, innerHeight - tip.getBoundingClientRect().height - 8))}px`;
    return () => {
      if (tip.isConnected) tip.hidePopover();
    };
  }, [open, text]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const outside = (event: PointerEvent) => {
      if (
        !trigger.current?.contains(event.target as Node) &&
        !popup.current?.contains(event.target as Node)
      )
        close();
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);
  const props = children.props;
  return (
    <>
      {cloneElement(children, {
        title: undefined,
        "aria-describedby": open
          ? [props["aria-describedby"], id].filter(Boolean).join(" ")
          : props["aria-describedby"],
        onPointerEnter: (event) => {
          props.onPointerEnter?.(event);
          trigger.current = event.currentTarget;
          cancel();
          delay.current = setTimeout(() => setOpen(true), 350);
        },
        onPointerLeave: (event) => {
          props.onPointerLeave?.(event);
          leave();
        },
        onFocus: (event) => {
          props.onFocus?.(event);
          if (event.target !== event.currentTarget) return;
          trigger.current = event.currentTarget;
          cancel();
          setOpen(true);
        },
        onBlur: (event) => {
          props.onBlur?.(event);
          if (!popup.current?.contains(event.relatedTarget as Node)) close();
        },
        onPointerDown: (event) => {
          close();
          props.onPointerDown?.(event);
        },
        onContextMenu: (event) => {
          close();
          props.onContextMenu?.(event);
        },
      })}
      {open &&
        createPortal(
          <div
            id={id}
            ref={popup}
            role="tooltip"
            popover="manual"
            className="real-tooltip"
            onPointerEnter={cancel}
            onPointerLeave={leave}
          >
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
