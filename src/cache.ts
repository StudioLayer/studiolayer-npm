/**
 * Read caching for the content client. GET responses (schema, record lists,
 * single records, queries) are cached by request key and kept fresh by
 * conditional revalidation: each entry stores the studio's `ETag`, which the
 * client sends back as `If-None-Match`. A cheap project-wide stamp gates whether
 * a revalidation is even attempted, so a stable site serves straight from cache.
 *
 * Swap in a custom `CacheStore` to share a cache across client instances or to
 * back it with something persistent.
 */

export interface CacheEntry {
  value: unknown
  /**
   * The studio's validator (`ETag`) for this value. Sent back as `If-None-Match`
   * to revalidate: a `304` means the stored value is still current.
   */
  etag?: string
  /**
   * The project stamp this entry was last confirmed current against. When it
   * equals the client's latest known stamp, the entry is served without any
   * network call at all.
   */
  validatedVersion?: string
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
  /**
   * How long a cached entry survives, in ms. Default `604800000` (7 days).
   *
   * This is NOT how long until content refreshes - revalidation keeps entries
   * current within `revalidate` (seconds) whenever the studio is reachable. The
   * TTL is really the outage window: how long the site keeps serving the
   * last-known content while the studio is unreachable, before an entry is
   * dropped and a read must hit the network again. A generous default so a
   * studio outage degrades to "slightly stale" rather than "site errors".
   *
   * The one case where it bounds staleness directly is when revalidation is off
   * (`revalidate: false`) or the server has no `/version` endpoint: then content
   * can be up to `ttl` old. `0` = never expire.
   */
  ttl?: number
  /**
   * Minimum ms between two project-stamp checks. Default `60000` (1 minute) -
   * this is the freshness window for PUBLIC visitors (an edit is picked up on
   * the next check after it lands); an editor viewing a surface preview bypasses
   * the cache entirely and always sees changes instantly.
   *
   * The check fires only on a read and is throttled, so a quiet site barely
   * checks at all; the interval only caps the busy case. Each check costs the
   * studio a small API-key lookup, so raise it (a few minutes) if you run many
   * frontends; lower it for a tighter public window. `false` disables checking
   * and leaves you with pure TTL expiry.
   */
  revalidate?: number | false
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
 * Thin cache facade the client talks to. Owns TTL logic, conditional-revalidation
 * bookkeeping (etag + validated stamp), and prefix invalidation, so the client
 * only deals in cache keys.
 */
export class ContentCache {
  readonly enabled: boolean
  private ttl: number
  private store: CacheStore

  constructor(opts: CacheOptions = {}) {
    this.enabled = opts.enabled ?? true
    this.ttl = opts.ttl ?? 604_800_000
    this.store = opts.store ?? new MemoryCacheStore(opts.maxEntries ?? 500)
  }

  /**
   * The live entry for `key`, or `undefined` on miss / TTL expiry. Returns the
   * whole entry (value + etag + validated stamp) so the client can decide
   * whether to serve it, revalidate it, or fall back to it on error.
   */
  peek(key: string, now: number): CacheEntry | undefined {
    if (!this.enabled) return undefined
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt !== 0 && entry.expiresAt <= now) {
      this.store.delete(key)
      return undefined
    }
    return entry
  }

  /** Store a freshly fetched value with its validator and the stamp it is current against. */
  set(key: string, value: unknown, opts: { etag?: string, version?: string }, now: number): void {
    if (!this.enabled) return
    this.store.set(key, {
      value,
      etag: opts.etag,
      validatedVersion: opts.version,
      expiresAt: this.ttl === 0 ? 0 : now + this.ttl,
    })
  }

  /**
   * Record that an existing entry is still current as of `version` (after a
   * `304`), refreshing its TTL without touching the value. No-op if it is gone.
   */
  confirm(key: string, version: string | undefined, now: number): void {
    const entry = this.store.get(key)
    if (!entry) return
    entry.validatedVersion = version
    entry.expiresAt = this.ttl === 0 ? 0 : now + this.ttl
    this.store.set(key, entry)
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
