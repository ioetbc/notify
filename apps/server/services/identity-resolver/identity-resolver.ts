export interface HogPayload {
  event: string;
  distinct_id: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

export interface IntegrationConfig {
  identityField: string;
}

/** Resolve a user's external ID from a PostHog Hog function payload. */
export function resolveIdentity(
  payload: HogPayload,
  config: IntegrationConfig
): string | null {
  if (config.identityField === "distinct_id") {
    return payload.distinct_id || null;
  }

  const value = payload.properties?.[config.identityField];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }

  return null;
}
