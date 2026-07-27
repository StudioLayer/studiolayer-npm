export { StudioLayerClient, DatasetHandle, DEFAULT_BASE_URL, PREVIEW_PARAM, isPreviewRequest } from './client'
export type { StudioLayerClientOptions, ReadOptions, PreviewInput } from './client'
export { StudioLayerError } from './errors'
export { ContentCache, MemoryCacheStore } from './cache'
export type { CacheOptions, CacheStore, CacheEntry } from './cache'
export type {
  ContentSchema,
  SchemaNode,
  SchemaDataset,
  SchemaField,
  FieldKind,
  FieldType,
  ContentRecord,
  ContentLocale,
  QueryResult,
  QueryShape,
} from './types'

import { StudioLayerClient, type StudioLayerClientOptions } from './client'

/** Convenience factory: `createClient({ apiKey, baseUrl })`. */
export function createClient(options: StudioLayerClientOptions): StudioLayerClient {
  return new StudioLayerClient(options)
}
