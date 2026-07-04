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

/** Response of `GET /schema`: the full content shape this key can reach. */
export interface ContentSchema {
  nodes: SchemaNode[]
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
