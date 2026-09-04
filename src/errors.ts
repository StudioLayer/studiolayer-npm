/**
 * Error thrown for any non-2xx response from the content API. `status` carries
 * the HTTP status code so callers can branch (401 bad key, 403 out of scope,
 * 404 missing node/dataset/record, 422 query failed).
 */
export class JustmadeError extends Error {
  readonly status: number
  /** The raw parsed response body, when the server returned one. */
  readonly body: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'JustmadeError'
    this.status = status
    this.body = body
    // Restore prototype chain for `instanceof` when transpiled to ES5.
    Object.setPrototypeOf(this, JustmadeError.prototype)
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }

  get isForbidden(): boolean {
    return this.status === 403
  }

  get isNotFound(): boolean {
    return this.status === 404
  }
}
