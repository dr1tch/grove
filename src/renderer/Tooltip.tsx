import { cloneElement, useState, type ReactElement, type HTMLAttributes } from "react";
import { Tooltip as RadixTooltip } from "radix-ui";
import { overlayContainer } from "./Overlay";
import "./radix-controls.css";
export function Tooltip({
  text,
  children,
  hidden = false,
}: {
  text: string;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  hidden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <RadixTooltip.Provider delayDuration={350}>
      <RadixTooltip.Root open={open && !hidden} onOpenChange={setOpen}>
        <RadixTooltip.Trigger asChild>
          {cloneElement(children, { title: undefined })}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal container={overlayContainer()}>
          <RadixTooltip.Content
            className="real-tooltip grove-tooltip"
            sideOffset={8}
            collisionPadding={8}
          >
            {text}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
