/**
 * Project-stamp tracker: the cheap gate in front of conditional revalidation.
 *
 * The cache lives in YOUR process, so the studio cannot push an invalidation
 * into it. Instead it publishes a stamp per project at `GET /api/content/version`
 * that changes on every content edit. This tracker fetches that stamp at most
 * once per interval (one tiny request regardless of read volume) and exposes the
 * latest value it has seen.
 *
 * The client uses it as a gate: while the stamp is unchanged, cached entries are
 * served with no network at all; when it moves, entries revalidate individually
 * with `If-None-Match` (a `304` keeps the cached value, a `200` replaces it). If
 * the stamp check itself fails - studio down, network blip - the last known
 * stamp stands, so the cache keeps serving instead of hammering a dead endpoint.
 */

export type VersionProbe = () => Promise<string>

export class VersionTracker {
    private lastChecked = 0
    private version: string | null = null
    private inFlight: Promise<void> | null = null
    /** Set when the server has no version route, so we stop asking. */
    private unsupported = false

    constructor(
        private readonly probe: VersionProbe,
        /** Minimum ms between two probes. `0` disables checking entirely. */
        private readonly interval: number,
    ) {}

    /** The most recent stamp seen, or `null` before the first successful probe. */
    current(): string | null {
        return this.version
    }

    /**
     * Refresh the stamp if we are due. Resolves once the answer is in, so the
     * read that triggered it sees an up-to-date stamp. A failed probe leaves the
     * last known stamp in place (serve-from-cache rather than thrash).
     */
    async refresh(now: number): Promise<void> {
        if (this.interval <= 0 || this.unsupported) return
        if (this.inFlight) return this.inFlight
        if (this.version !== null && now - this.lastChecked < this.interval) return

        this.lastChecked = now
        this.inFlight = this.run()
        try {
            await this.inFlight
        }
        finally {
            this.inFlight = null
        }
    }

    private async run(): Promise<void> {
        try {
            this.version = await this.probe()
        }
        catch (err) {
            // A server that predates the version route will never answer; stop
            // asking. Any other failure is transient - keep the last stamp so the
            // cache keeps serving, and try again next interval.
            if ((err as { status?: number })?.status === 404) this.unsupported = true
        }
    }
}
