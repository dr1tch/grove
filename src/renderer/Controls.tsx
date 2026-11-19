import type { ComponentProps, ReactNode } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Select, Checkbox, Slider, Collapsible } from "radix-ui";
import { overlayContainer } from "./Overlay";
import "./radix-controls.css";

export type SelectOption = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
};
type SelectFieldProps = Omit<
  ComponentProps<typeof Select.Trigger>,
  "children" | "value" | "onValueChange"
> & {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
};
export function SelectField({
  value,
  onValueChange,
  options,
  className = "",
  disabled,
  ...props
}: SelectFieldProps) {
  // Encode every value so an empty native option remains a real selectable item.
  const encode = (value: string) => `value:${value}`;
  return (
    <Select.Root
      value={encode(value)}
      onValueChange={(value) => onValueChange(value.slice(6))}
      disabled={disabled}
    >
      <Select.Trigger {...props} className={`grove-select ${className}`}>
        <Select.Value />
        <Select.Icon className="grove-select-icon">
          <ChevronDown size={12} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal container={overlayContainer()}>
        <Select.Content
          className="grove-select-menu"
          position="popper"
          sideOffset={4}
          collisionPadding={8}
        >
          <Select.ScrollUpButton className="grove-select-scroll">⌃</Select.ScrollUpButton>
          <Select.Viewport>
            {options.map((option) => (
              <Select.Item
                key={option.value}
                className="grove-select-option"
                value={encode(option.value)}
                disabled={option.disabled}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={13} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
          <Select.ScrollDownButton className="grove-select-scroll">⌄</Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export function CheckField({
  checked,
  onCheckedChange,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Checkbox.Root>, "checked" | "onCheckedChange"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Checkbox.Root
      {...props}
      checked={checked}
      onCheckedChange={(checked) => onCheckedChange(checked === true)}
      className={`grove-checkbox ${className}`}
    >
      <Checkbox.Indicator>
        <Check size={12} strokeWidth={3} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
export function SliderField({
  value,
  onValueChange,
  onValueCommit,
  className = "",
  "aria-label": label,
  ...props
}: Omit<ComponentProps<typeof Slider.Root>, "value" | "onValueChange" | "onValueCommit"> & {
  value: number;
  onValueChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
}) {
  return (
    <Slider.Root
      {...props}
      value={[value]}
      onValueChange={([value]) => onValueChange(value)}
      onValueCommit={onValueCommit ? ([value]) => onValueCommit(value) : undefined}
      className={`grove-slider ${className}`}
    >
      <Slider.Track className="grove-slider-track">
        <Slider.Range className="grove-slider-range" />
      </Slider.Track>
      <Slider.Thumb className="grove-slider-thumb" aria-label={label} />
    </Slider.Root>
  );
}
export function Disclosure({
  title,
  children,
  className = "",
  ...props
}: Omit<ComponentProps<typeof Collapsible.Root>, "title"> & {
  title: ReactNode;
}) {
  return (
    <Collapsible.Root {...props} className={`grove-disclosure ${className}`}>
      <Collapsible.Trigger className="grove-disclosure-trigger">
        <ChevronRight size={14} />
        {title}
      </Collapsible.Trigger>
      <Collapsible.Content forceMount className="grove-disclosure-content">
        {children}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
