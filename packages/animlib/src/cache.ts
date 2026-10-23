/** Bounded LRU for geometry shared by independently evaluated/cloned frames. */
export class GeometryCache<T> {
  private entries = new Map<string, { value: T; size: number }>();
  private size = 0;
  constructor(private readonly limit = 1024 * 1024) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number): T {
    const size = key.length * 2 + bytes;
    if (size > this.limit) return value;
    const old = this.entries.get(key);
    if (old) { this.size -= old.size; this.entries.delete(key); }
    while (this.size + size > this.limit) {
      const oldest = this.entries.keys().next().value!;
      this.size -= this.entries.get(oldest)!.size;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { value, size });
    this.size += size;
    return value;
  }
}
