// NotImplemented is thrown by every stub in lib/ai.ts and lib/geo.ts. Route
// handlers catch it and return 501 so the surrounding wiring (validation, rate
// limiting, persistence, caching) can be reviewed and exercised before the AI
// logic exists.
export class NotImplemented extends Error {
  readonly feature: string;
  constructor(feature: string) {
    super(`${feature} is not implemented yet (assigned to the AI owner — see lib/ai.ts / lib/geo.ts)`);
    this.name = "NotImplemented";
    this.feature = feature;
  }
}

// UpstreamError signals a failed external call (OpenAI / Google Maps). The AI
// owner should throw this on non-retryable upstream failures; routes map it to
// 502 (fail-closed) or a degraded 200/503 (fail-open) per the route's policy.
export class UpstreamError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "UpstreamError";
    this.retryable = retryable;
  }
}

// InvalidUpstreamResponse signals that an external call returned data that does
// not satisfy the contract (bad JSON, out-of-enum category, etc.). Always
// fail-closed on this.
export class InvalidUpstreamResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUpstreamResponse";
  }
}
