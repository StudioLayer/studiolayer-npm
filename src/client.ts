import { ContentCache, type CacheOptions } from './cache'
import { StudioLayerError } from './errors'
import type { ContentRecord, ContentSchema, QueryResult, SchemaNode } from './types'
import { VersionGate } from './version'

/**
 * Query parameter the StudioLayer studio appends when it loads your site in a
 * surface preview. Its presence means "an editor is looking at this right now",
 * which is exactly when caching must get out of the way - see `forRequest`.
 */
export const PREVIEW_PARAM = 'sl-preview'

/** Hosted StudioLayer platform. Used when no `baseUrl` is provided. */
export const DEFAULT_BASE_URL = 'https://app.studiolayer.io'

export interface StudioLayerClientOptions {
  /**
   * Project API key, `slk_...`. Mint one in the project's settings under
   * "API keys". Its reach is the union of its per-node read/write scopes.
   */
  apiKey: string
  /**
   * Base URL of your StudioLayer server, without a trailing `/api/content`
   * (that path is appended automatically). Defaults to the hosted platform at
   * `https://app.studiolayer.io`; override it for a self-hosted instance.
   */
  baseUrl?: string
  /** Read caching. Pass `false` to disable, or an options object to tune it. */
  cache?: boolean | CacheOptions
  /** Custom `fetch` implementation. Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** Extra headers merged into every request. */
  headers?: Record<string, string>
  /**
   * Force preview behaviour: every read bypasses the cache and refreshes it.
   * Usually you do not set this by hand - use `client.forRequest(req)`, which
   * turns it on only for requests that carry the studio's preview marker.
   */
  preview?: boolean
}

/** Per-call read options. */
export interface ReadOptions {
  /** Set `false` to bypass the cache for this call and always hit the network. */
  cache?: boolean
}

type Method = 'GET' | 'POST' | 'PATCH'

/**
 * Typed client for the StudioLayer content API: read and write a project's node
 * datasets from any website or app. Reads are cached (see the `cache` option);
 * writes invalidate the affected cache entries automatically.
 *
 * ```ts
 * const studio = new StudioLayerClient({ apiKey: 'slk_...', baseUrl: 'https://studio.example.com' })
 * const posts = await studio.dataset<Post>('blog', 'posts').list()
 * ```
 */
export class StudioLayerClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly headers: Record<string, string>
  /** Not readonly: `forRequest` hands its clone the SAME cache instance. */
  private cache: ContentCache
  private versionGate: VersionGate
  /** `false` on a preview-scoped clone, so reads bypass the cache by default. */
  private readDefault: boolean

  constructor(options: StudioLayerClientOptions) {
    if (!options.apiKey) throw new Error('StudioLayerClient: `apiKey` is required')

    this.apiKey = options.apiKey
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    const resolvedFetch = options.fetch ?? globalThis.fetch
    if (!resolvedFetch) {
      throw new Error('StudioLayerClient: no `fetch` available; pass one via options.fetch (Node < 18)')
    }
    this.fetchImpl = resolvedFetch.bind(globalThis)
    this.headers = options.headers ?? {}
    this.readDefault = options.preview !== true

    const cacheOpt = options.cache
    const cacheOptions: CacheOptions
      = cacheOpt === false ? { enabled: false }
        : cacheOpt === true || cacheOpt === undefined ? {}
          : cacheOpt
    this.cache = new ContentCache(cacheOptions)

    const revalidate = cacheOptions.enabled === false || cacheOptions.revalidate === false
      ? 0
      : cacheOptions.revalidate ?? 30_000
    this.versionGate = new VersionGate(
      async () => (await this.request<{ version: string }>('GET', '/version')).version,
      revalidate,
      () => this.cache.clear(),
    )
  }

  // ── Preview scoping ─────────────────────────────────────────────────────────

  /**
   * A per-request view of this client that skips the cache when the request
   * comes from a StudioLayer surface preview, and behaves exactly like this
   * client otherwise. Reads still refresh the shared cache, so an editor
   * refreshing the preview also warms what real visitors get.
   *
   * Accepts whatever your framework hands you: a `Request`, a URL string or
   * `URL`, `URLSearchParams`, or a plain searchParams object.
   *
   * ```ts
   * // Next.js app router
   * export default async function Page({ searchParams }) {
   *   const posts = await studio.forRequest(await searchParams).dataset('blog', 'posts').list()
   * }
   * ```
   *
   * Note this only bypasses the SDK's own cache. If the page itself sits behind
   * a CDN or framework data cache, that layer needs the same treatment (e.g.
   * `cache: 'no-store'` when the preview marker is present) or the editor keeps
   * seeing a stale page no matter what this client returns.
   */
  forRequest(input: PreviewInput): StudioLayerClient {
    if (!this.readDefault) return this // already a preview client
    if (!isPreviewRequest(input)) return this

    const clone = new StudioLayerClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
      fetch: this.fetchImpl,
      headers: this.headers,
      preview: true,
    })
    // Share the cache and the version gate: the preview must invalidate what
    // the public site reads, not maintain a second universe of its own.
    clone.cache = this.cache
    clone.versionGate = this.versionGate
    return clone
  }

  /** Whether this client bypasses the cache (i.e. came from a preview request). */
  get isPreview(): boolean {
    return !this.readDefault
  }

  // ── Introspection ─────────────────────────────────────────────────────────

  /** The full content shape this key can reach: nodes, datasets, field schemas. */
  async schema(opts?: ReadOptions): Promise<ContentSchema> {
    return this.cachedGet<ContentSchema>('schema', '/schema', opts)
  }

  /** Shorthand for `schema()` then `.nodes`. */
  async nodes(opts?: ReadOptions): Promise<SchemaNode[]> {
    return (await this.schema(opts)).nodes
  }

  // ── Records ───────────────────────────────────────────────────────────────

  /** List every record in a dataset (references inflated). Requires read scope. */
  async listRecords<T = Record<string, unknown>>(
    nodeSlug: string,
    datasetSlug: string,
    opts?: ReadOptions,
  ): Promise<ContentRecord<T>[]> {
    const res = await this.cachedGet<{ records: ContentRecord<T>[] }>(
      recordsKey(nodeSlug, datasetSlug),
      datasetPath(nodeSlug, datasetSlug),
      opts,
    )
    return res.records
  }

  /** Read one record by uid. Requires read scope. Throws 404 if it does not exist. */
  async getRecord<T = Record<string, unknown>>(
    nodeSlug: string,
    datasetSlug: string,
    recordUid: string,
    opts?: ReadOptions,
  ): Promise<ContentRecord<T>> {
    const res = await this.cachedGet<{ record: ContentRecord<T> }>(
      recordKey(nodeSlug, datasetSlug, recordUid),
      `${datasetPath(nodeSlug, datasetSlug)}/${encodeURIComponent(recordUid)}`,
      opts,
    )
    return res.record
  }

  /** Create a record. Requires write scope. Invalidates cached reads of the dataset. */
  async createRecord<T = Record<string, unknown>>(
    nodeSlug: string,
    datasetSlug: string,
    data: Record<string, unknown>,
  ): Promise<ContentRecord<T>> {
    const res = await this.request<{ record: ContentRecord<T> }>(
      'POST',
      datasetPath(nodeSlug, datasetSlug),
      { data },
    )
    this.invalidateDataset(nodeSlug, datasetSlug)
    return res.record
  }

  /**
   * Partially update a record. The patch is merged onto the stored data (omitted
   * top-level fields are preserved). Requires write scope. Invalidates cached
   * reads of the dataset and of this record.
   */
  async updateRecord<T = Record<string, unknown>>(
    nodeSlug: string,
    datasetSlug: string,
    recordUid: string,
    data: Record<string, unknown>,
  ): Promise<ContentRecord<T>> {
    const res = await this.request<{ record: ContentRecord<T> }>(
      'PATCH',
      `${datasetPath(nodeSlug, datasetSlug)}/${encodeURIComponent(recordUid)}`,
      { data },
    )
    this.invalidateDataset(nodeSlug, datasetSlug)
    this.cache.delete(recordKey(nodeSlug, datasetSlug, recordUid))
    return res.record
  }

  // -- Queries --

  /** Run a saved query (`queries.<slug>`) and return its result. Requires read scope. */
  async query<V = unknown>(querySlug: string, opts?: ReadOptions): Promise<QueryResult<V>> {
    return this.cachedGet<QueryResult<V>>(
      `query:${querySlug}`,
      `/queries/${encodeURIComponent(querySlug)}`,
      opts,
    )
  }

  // ── Fluent dataset handle ───────────────────────────────────────────────────

  /**
   * A fluent, type-parameterised handle to one dataset:
   * `client.dataset<Post>('blog', 'posts').list()`.
   */
  dataset<T = Record<string, unknown>>(nodeSlug: string, datasetSlug: string): DatasetHandle<T> {
    return new DatasetHandle<T>(this, nodeSlug, datasetSlug)
  }

  // ── Cache control ───────────────────────────────────────────────────────────

  /**
   * Clear cached reads. With no argument, clears everything. Pass a scope to
   * clear just part of it: a node slug, or `{ node, dataset }` for one dataset.
   */
  clearCache(scope?: string | { node: string, dataset?: string }): void {
    if (scope === undefined) {
      this.cache.clear()
      return
    }
    if (typeof scope === 'string') {
      this.cache.deletePrefix(`records:${scope}/`)
      this.cache.deletePrefix(`record:${scope}/`)
      return
    }
    if (scope.dataset) {
      this.invalidateDataset(scope.node, scope.dataset)
    } else {
      this.cache.deletePrefix(`records:${scope.node}/`)
      this.cache.deletePrefix(`record:${scope.node}/`)
    }
  }

  /** Drop cached record reads for a dataset, plus all query results (which may aggregate it). */
  private invalidateDataset(nodeSlug: string, datasetSlug: string): void {
    this.cache.delete(recordsKey(nodeSlug, datasetSlug))
    this.cache.deletePrefix(`${recordKey(nodeSlug, datasetSlug, '')}`)
    this.cache.deletePrefix('query:')
  }

  // ── Transport ───────────────────────────────────────────────────────────────

  private async cachedGet<T>(cacheKey: string, path: string, opts?: ReadOptions): Promise<T> {
    const useCache = opts?.cache ?? this.readDefault
    if (useCache) {
      // Cheap, throttled: at most one stamp check per `revalidate` window.
      await this.versionGate.check(Date.now())
      const hit = this.cache.get<T>(cacheKey, Date.now())
      if (hit !== undefined) return hit
    }
    const value = await this.request<T>('GET', path)
    // Written back even when the cache was bypassed: leaving a stale entry in
    // place would serve it to the very next default read.
    this.cache.set(cacheKey, value, Date.now())
    return value
  }

  private async request<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/content${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...this.headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })

    if (!res.ok) {
      let message = res.statusText || `Request failed with status ${res.status}`
      let parsed: unknown
      try {
        parsed = await res.json()
        const m = parsed as { message?: unknown, statusMessage?: unknown }
        if (typeof m?.message === 'string') message = m.message
        else if (typeof m?.statusMessage === 'string') message = m.statusMessage
      } catch {
        /* non-JSON error body; keep the status text */
      }
      throw new StudioLayerError(message, res.status, parsed)
    }

    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }
}

/** Fluent, dataset-scoped view returned by `client.dataset()`. */
export class DatasetHandle<T = Record<string, unknown>> {
  constructor(
    private readonly client: StudioLayerClient,
    private readonly nodeSlug: string,
    private readonly datasetSlug: string,
  ) {}

  list(opts?: ReadOptions): Promise<ContentRecord<T>[]> {
    return this.client.listRecords<T>(this.nodeSlug, this.datasetSlug, opts)
  }

  get(recordUid: string, opts?: ReadOptions): Promise<ContentRecord<T>> {
    return this.client.getRecord<T>(this.nodeSlug, this.datasetSlug, recordUid, opts)
  }

  create(data: Record<string, unknown>): Promise<ContentRecord<T>> {
    return this.client.createRecord<T>(this.nodeSlug, this.datasetSlug, data)
  }

  update(recordUid: string, data: Record<string, unknown>): Promise<ContentRecord<T>> {
    return this.client.updateRecord<T>(this.nodeSlug, this.datasetSlug, recordUid, data)
  }

  /** Clear cached reads for this dataset. */
  clearCache(): void {
    this.client.clearCache({ node: this.nodeSlug, dataset: this.datasetSlug })
  }
}

// ── Preview detection ─────────────────────────────────────────────────────────

/** Anything a framework might hand you that could carry the preview marker. */
export type PreviewInput
  = | string
    | URL
    | URLSearchParams
    | { url: string }
    | Record<string, string | string[] | undefined>
    | null
    | undefined

/**
 * True when the request was opened from a StudioLayer surface preview, i.e. it
 * carries the `sl-preview` query parameter the studio appends to the iframe URL.
 */
export function isPreviewRequest(input: PreviewInput): boolean {
  if (!input) return false

  if (typeof input === 'string') {
    // Either a full URL or a bare query string ("?a=1" / "a=1").
    const query = input.includes('?') ? input.slice(input.indexOf('?') + 1) : input
    return new URLSearchParams(query).has(PREVIEW_PARAM)
  }
  if (input instanceof URLSearchParams) return input.has(PREVIEW_PARAM)
  if (input instanceof URL) return input.searchParams.has(PREVIEW_PARAM)
  if (typeof (input as { url?: unknown }).url === 'string') {
    return isPreviewRequest((input as { url: string }).url)
  }
  return Object.prototype.hasOwnProperty.call(input, PREVIEW_PARAM)
}

// ── Cache-key + path helpers ──────────────────────────────────────────────────

function datasetPath(nodeSlug: string, datasetSlug: string): string {
  return `/nodes/${encodeURIComponent(nodeSlug)}/datasets/${encodeURIComponent(datasetSlug)}/records`
}

function recordsKey(nodeSlug: string, datasetSlug: string): string {
  return `records:${nodeSlug}/${datasetSlug}`
}

function recordKey(nodeSlug: string, datasetSlug: string, recordUid: string): string {
  return `record:${nodeSlug}/${datasetSlug}/${recordUid}`
}
