# @studiolayer/client

Typed client for the StudioLayer **content API**. Read and write a project's
node datasets from any website or app: headless-CMS style, and beyond.

Your site talks to project **nodes** over a small, key-authenticated REST
surface (`/api/content/*`). A **project API key** (`slk_...`) grants read and/or
write access to specific nodes and datasets. This package wraps that surface in
a fully typed client with built-in read caching.

- Zero dependencies, works in Node 18+ and the browser (the API sends permissive CORS).
- Dual ESM / CommonJS build, full TypeScript types.
- Read caching with TTL, automatic invalidation on writes, and a `clearCache()` method.

## Install

```bash
npm install @studiolayer/client
```

## Quick start

```ts
import { createClient } from '@studiolayer/client'

const studio = createClient({
  apiKey: process.env.STUDIOLAYER_API_KEY!, // slk_...
  // baseUrl defaults to https://app.studiolayer.io;
  // set it only for a self-hosted server:
  // baseUrl: 'https://studio.example.com',
})

// Discover what this key can reach.
const { nodes } = await studio.schema()

// List records from a dataset.
const posts = await studio.listRecords('blog', 'posts')

// Or use the fluent, typed handle.
interface Post { title: string, slug: string, body: string, published: boolean }
const blog = studio.dataset<Post>('blog', 'posts')

const all = await blog.list()
const one = await blog.get('rec_abc123')
const created = await blog.create({ title: 'Hello', slug: 'hello', body: '...', published: true })
const updated = await blog.update('rec_abc123', { published: false })
```

Each record is `{ uid, data, createdAt, updatedAt }`, where `data` is keyed by
field slug with references (files, referenced records) already inflated.

## Authentication & scopes

Pass the project API key as `apiKey`. A key's reach is the union of its per-node
scopes (read and/or write, optionally narrowed to specific datasets). Calls
outside the key's scope throw a `StudioLayerError` with `status` 403; an
unknown node/dataset/record throws 404.

```ts
import { StudioLayerError } from '@studiolayer/client'

try {
  await studio.getRecord('blog', 'posts', 'nope')
} catch (err) {
  if (err instanceof StudioLayerError && err.isNotFound) {
    // handle missing record
  }
}
```

## Introspection

`schema()` returns every node the key can reach, the datasets within, each
dataset's field schema, and `canRead` / `canWrite` flags so a site can adapt to
its access without hardcoding slugs.

```ts
for (const node of await studio.nodes()) {
  for (const ds of node.datasets) {
    console.log(node.slug, ds.slug, ds.canWrite ? '(writable)' : '(read-only)')
  }
}
```

## Saved queries

Run a server-defined query (`queries.<slug>`) and get its result. The `shape`
tells you whether `value` is a `collection`, a `single` record, or a scalar
`value`.

```ts
const result = await studio.query('featured-posts')
if (result.shape === 'collection') {
  // result.value is an array of records
}
```

## Caching

Reads (`schema`, `listRecords`, `getRecord`, `query`) are cached in memory.
Writes (`createRecord`, `updateRecord`) automatically invalidate the affected
dataset's cached reads (and all query results, since a query may aggregate it).

```ts
const studio = createClient({
  apiKey, baseUrl,
  cache: { ttl: 30_000, maxEntries: 1000 }, // defaults: ttl 4h, maxEntries 500
})

// Disable entirely:
createClient({ apiKey, baseUrl, cache: false })

// Bypass the cache for a single call:
await studio.listRecords('blog', 'posts', { cache: false })
```

### Clearing the cache

```ts
studio.clearCache()                               // everything
studio.clearCache('blog')                         // one node
studio.clearCache({ node: 'blog', dataset: 'posts' }) // one dataset
studio.dataset('blog', 'posts').clearCache()      // same, fluent
```

Bring your own store (share a cache across instances, or persist it) by
implementing `CacheStore` and passing it as `cache.store`.

## API

| Method | Description |
| --- | --- |
| `schema(opts?)` | Full reachable content shape (`{ nodes }`). |
| `nodes(opts?)` | Shortcut for `schema().nodes`. |
| `listRecords<T>(node, dataset, opts?)` | All records in a dataset. |
| `getRecord<T>(node, dataset, uid, opts?)` | One record by uid. |
| `createRecord<T>(node, dataset, data)` | Create a record (needs write scope). |
| `updateRecord<T>(node, dataset, uid, data)` | Merge-patch a record (needs write scope). |
| `query<V>(slug, opts?)` | Run a saved query. |
| `dataset<T>(node, dataset)` | Fluent handle: `.list() .get() .create() .update() .clearCache()`. |
| `clearCache(scope?)` | Clear all, one node, or one dataset. |

`opts` is `{ cache?: boolean }`. All read methods accept a row type parameter
`<T>` for `record.data`.

## Node < 18

Global `fetch` is required. On older runtimes, pass one:

```ts
import fetch from 'node-fetch'
createClient({ apiKey, baseUrl, fetch: fetch as unknown as typeof globalThis.fetch })
```

## License

MIT
