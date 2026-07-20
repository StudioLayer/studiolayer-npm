/**
 * Cross-process cache invalidation.
 *
 * The cache lives in YOUR process, so StudioLayer cannot push an invalidation
 * into it: a serverless instance, a long-running Node server and a browser tab
 * each hold their own copy. Instead the studio publishes a stamp per project at
 * `GET /api/content/version` that changes on every content edit (and when
 * someone hits "Publish" in the studio). This gate polls that stamp - by default
 * at most once every 30 seconds, regardless of how many reads happen - and
 * flushes the whole cache when it moves.
 *
 * The result: the TTL is the worst case ("live within an hour"), the stamp is
 * the normal case ("live within seconds"), and neither needs any wiring on the
 * consuming site.
 */

export type VersionProbe = () => Promise<string>

export class VersionGate {
    private lastChecked = 0
    private lastVersion: string | null = null
    private inFlight: Promise<void> | null = null
    /** Set when the server has no version route, so we stop asking. */
    private unsupported = false

    constructor(
        private readonly probe: VersionProbe,
        /** Minimum ms between two probes. `0` disables the gate entirely. */
        private readonly interval: number,
        private readonly onChange: () => void,
    ) {}

    /**
     * Probe if we are due. Resolves once the answer is in, so the read that
     * triggered it never serves a value the stamp just invalidated. Costs one
     * cheap request per interval, not per read.
     */
    async check(now: number): Promise<void> {
        if (this.interval <= 0 || this.unsupported) return
        if (this.inFlight) return this.inFlight
        if (now - this.lastChecked < this.interval) return

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
        let version: string
        try {
            version = await this.probe()
        }
        catch (err) {
            // A server that predates the version route will never answer; stop
            // polling it. Any other failure (network blip, 500) is transient:
            // keep the cached data and try again next interval.
            if ((err as { status?: number })?.status === 404) this.unsupported = true
            return
        }

        // First successful probe only establishes the baseline - flushing then
        // would throw away a perfectly warm cache on every cold start.
        if (this.lastVersion !== null && this.lastVersion !== version) this.onChange()
        this.lastVersion = version
    }
}
