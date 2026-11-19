/** Shell renders can acknowledge an older keystroke after newer bridge events arrive. */
export class SourceAcknowledgements {
  private previousProp: string;
  private pending: string[] = [];
  private retained = 0;
  constructor(initial: string) {
    this.previousProp = initial;
  }
  record(value: string) {
    this.pending.push(value);
    this.retained += value.length;
  }
  /** True only when the shell supplied source that was never emitted by this editor. */
  isExternal(value: string) {
    const index = this.pending.lastIndexOf(value);
    if (index >= 0) {
      for (const acknowledged of this.pending.splice(0, index + 1))
        this.retained -= acknowledged.length;
      this.previousProp = value;
      return false;
    }
    if (value === this.previousProp) return false;
    this.previousProp = value;
    this.pending = [];
    this.retained = 0;
    return true;
  }
  get needsAcknowledgement() {
    return this.pending.length >= 32 || this.retained >= 4 * 1024 * 1024;
  }
}
