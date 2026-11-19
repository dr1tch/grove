import { SelectField } from "./Controls";
import type { Settings } from "../shared/types";
export type PreviewStyleValue = NonNullable<Settings["previewStyle"]>;
export function PreviewStyle({
  value,
  change,
}: {
  value: PreviewStyleValue;
  change: (value: PreviewStyleValue) => void;
}) {
  return (
    <SelectField
      className="preview-style"
      aria-label="Preview editing style"
      value={value}
      onValueChange={(value) => change(value as PreviewStyleValue)}
      options={[
        { value: "formatted", label: "Formatted" },
        { value: "live", label: "Live Preview" },
      ]}
    />
  );
}
