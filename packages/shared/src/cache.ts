interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): { value: T; hit: true } | { hit: false } {
    const entry = this.store.get(key);
    if (!entry) return { hit: false };
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return { hit: false };
    }
    return { value: entry.value as T, hit: true };
  }

  set<T>(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
