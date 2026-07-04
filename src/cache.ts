/**
 * Read caching for the content client. GET responses (schema, record lists,
 * single records, queries) are cached by request key; writes invalidate the
 * affected keys automatically. Swap in a custom `CacheStore` to share a cache
 * across client instances or to back it with something persistent.
 */

export interface CacheEntry {
  value: unknown
  /** Epoch ms when the entry expires. `0` means it never expires. */
  expiresAt: number
}

/** Pluggable backing store. The default is an in-memory, insertion-ordered map. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined
  set(key: string, entry: CacheEntry): void
  delete(key: string): void
  /** Iterate current keys (used for prefix invalidation). */
  keys(): Iterable<string>
  clear(): void
}

export interface CacheOptions {
  /** Master switch. Default `true`. */
  enabled?: boolean
  /** Time-to-live for cached reads, in ms. Default `60000`. `0` = never expires. */
  ttl?: number
  /** Soft cap on entries; oldest are evicted first. Default `500`. */
  maxEntries?: number
  /** Custom backing store. Defaults to an in-memory store. */
  store?: CacheStore
}

/** In-memory store with insertion-order (FIFO) eviction once `maxEntries` is hit. */
export class MemoryCacheStore implements CacheStore {
  private map = new Map<string, CacheEntry>()

  constructor(private maxEntries = 500) {}

  get(key: string): CacheEntry | undefined {
    return this.map.get(key)
  }

  set(key: string, entry: CacheEntry): void {
    // Re-insert so recently written keys are considered newest.
    this.map.delete(key)
    this.map.set(key, entry)
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  keys(): Iterable<string> {
    return this.map.keys()
  }

  clear(): void {
    this.map.clear()
  }
}

/**
 * Thin cache facade the client talks to. Owns TTL logic and prefix-based
 * invalidation so the client only deals in cache keys.
 */
export class ContentCache {
  readonly enabled: boolean
  private ttl: number
  private store: CacheStore

  constructor(opts: CacheOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.ttl = opts.ttl ?? 60_000
    this.store = opts.store ?? new MemoryCacheStore(opts.maxEntries ?? 500)
  }

  /** Return a fresh cached value for `key`, or `undefined` on miss/expiry. */
  get<T>(key: string, now: number): T | undefined {
    if (!this.enabled) return undefined
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== 0 && entry.expiresAt <= now) {
      this.store.delete(key)
      return undefined
    }
    return entry.value as T
  }

  set(key: string, value: unknown, now: number): void {
    if (!this.enabled) return
    this.store.set(key, { value, expiresAt: this.ttl === 0 ? 0 : now + this.ttl })
  }

  /** Drop one exact key. */
  delete(key: string): void {
    this.store.delete(key)
  }

  /** Drop every key that starts with `prefix`. */
  deletePrefix(prefix: string): void {
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) this.store.delete(key)
    }
  }

  clear(): void {
    this.store.clear()
  }
}
