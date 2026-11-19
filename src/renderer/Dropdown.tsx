import type { ComponentProps, ReactElement, ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { overlayContainer } from "./Overlay";
import "./radix-app.css";

export function Dropdown({
  open,
  onOpenChange,
  label,
  trigger,
  className = "",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  trigger: ReactElement;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal container={overlayContainer()}>
        <DropdownMenu.Content
          className={`menu grove-dropdown ${className}`}
          aria-label={label}
          align="end"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
export function DropdownItem(props: ComponentProps<"button">) {
  return (
    <DropdownMenu.Item asChild disabled={props.disabled}>
      <button type="button" {...props} />
    </DropdownMenu.Item>
  );
}
