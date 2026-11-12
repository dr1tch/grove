export const MAX_SYNC_BYTES = 50 * 1024 * 1024;

/** `dir/Note.md` -> `dir/Note (conflict <device> YYYY-MM-DD).md`, then ` 2`, ` 3` while taken. */
export function conflictCopyName(
  path: string,
  device: string,
  date: Date,
  exists: (path: string) => boolean = () => false,
): string {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [file.slice(0, dot), file.slice(dot)] : [file, ""];
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const base = `${dir}${stem} (conflict ${device.replace(/[/\\]/g, "-")} ${day})`;
  for (let n = 1; ; n++) {
    const name = `${base}${n > 1 ? ` ${n}` : ""}${ext}`;
    if (!exists(name)) return name;
  }
}
