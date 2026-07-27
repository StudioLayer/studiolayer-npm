/**
 * Wire types for the StudioLayer content API. These mirror the server DTOs
 * (`server/utils/content/*`, `server/api/content/*`) one-to-one. Slugs are used
 * on the wire; internal database ids never leak.
 */

/** Top-level shape category of a dataset field. */
export type FieldKind = 'primitive' | 'object' | 'collection' | 'reference'

/** The primitive field types the platform ships. `reference` and `''` also occur. */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'boolean'
  | 'color'
  | 'date'
  | 'email'
  | 'file'
  | 'image'
  | 'identifier'
  | 'json'
  | 'select'
  | 'url'
  | 'reference'
  | ''

/** One field in a dataset's schema, as returned by `GET /schema`. */
export interface SchemaField {
  slug: string
  label: string
  kind: FieldKind
  type: FieldType
  required: boolean
  description: string | null
}

/** A dataset reachable by the key, with its field schema and this key's access. */
export interface SchemaDataset {
  slug: string
  name: string
  description: string | null
  type: string
  /** Whether the key may read records from this dataset. */
  canRead: boolean
  /** Whether the key may create/update records in this dataset. */
  canWrite: boolean
  fields: SchemaField[]
}

/** A node reachable by the key, with the datasets it exposes. */
export interface SchemaNode {
  slug: string
  name: string
  description: string | null
  datasets: SchemaDataset[]
}

/**
 * A language the project's dataset content is available in. Request a non-default
 * locale on reads (client `locale` option or per-call `opts.locale`); untranslated
 * fields fall back to the default locale automatically.
 */
export interface ContentLocale {
  /** BCP-47 code, e.g. `en`, `nl`, `fr-BE`. */
  code: string
  label: string
  /** The language records are authored in and the fallback for untranslated fields. */
  isDefault: boolean
  /**
   * Served when a requested language matches no configured locale (e.g. a German
   * visitor on a Dutch/English site). When none is marked, unmatched requests
   * fall back to the default. The studio resolves this server-side; you never
   * have to send it.
   */
  isFallback: boolean
}

/** Response of `GET /schema`: the full content shape this key can reach. */
export interface ContentSchema {
  nodes: SchemaNode[]
  /** The locales this project's content can be requested in (default first). */
  locales: ContentLocale[]
}

/**
 * A single content record. `data` holds the field values keyed by field slug,
 * with references already inflated (file URLs, referenced-record snapshots).
 * Parameterise it with your own row type for full type safety.
 */
export interface ContentRecord<T = Record<string, unknown>> {
  uid: string
  data: T
  createdAt: string
  updatedAt: string
}

/** Result shape of a saved query, mirroring the query engine. */
export type QueryShape = 'collection' | 'single' | 'value'

/** Response of `GET /queries/:slug`. `value` type depends on `shape`. */
export interface QueryResult<V = unknown> {
  query: string
  shape: QueryShape
  value: V
}
