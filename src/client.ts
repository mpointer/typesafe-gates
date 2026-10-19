import {
  TypeSafeClient,
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  type TypeSafeClientConfig,
} from "@typesafe-ai/sdk";

/**
 * The slice of `TypeSafeClient` this package calls. Anything with a
 * compatible `systemOne` works, which keeps tests free of network access.
 */
export interface SystemOneClient {
  systemOne<const Q extends Questions>(
    request: SystemOneRequest<Q>,
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

/** Defaults chosen for gates that sit in a request or job path: one retry,
 * so a second failure surfaces to the caller's fallback instead of
 * stretching a run; a per-attempt timeout well under typical job budgets. */
export const DEFAULT_CLIENT_CONFIG: TypeSafeClientConfig = {
  timeout: 15_000,
  retry: { maxRetries: 1 },
};

/**
 * Build a client from `TYPESAFE_API_KEY`, or return `null` when the key is
 * unset or blank. Callers then take their no-TypeSafe path; this function
 * never decides what a missing key means for a gate.
 */
export function clientFromEnv(
  config: TypeSafeClientConfig = {},
  env: Record<string, string | undefined> = process.env,
): SystemOneClient | null {
  const apiKey = config.apiKey ?? env.TYPESAFE_API_KEY;
  if (!apiKey?.trim()) return null;
  return new TypeSafeClient({ ...DEFAULT_CLIENT_CONFIG, ...config, apiKey });
}
