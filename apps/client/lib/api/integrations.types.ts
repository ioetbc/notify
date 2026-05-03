export type IntegrationSummary = {
  id: string;
  provider: 'posthog';
  project_id: string;
  connected_at: string;
};

export type EventSummary = {
  name: string;
  volume: number;
  active: boolean;
};

export type ConnectInput = {
  personal_api_key: string;
  project_id: string;
  region: 'us' | 'eu';
};

export type EventListOptions = {
  days?: number;
  limit?: number;
  includeAutocaptured?: boolean;
};

export type IntegrationError =
  | { kind: 'posthog_auth_failed' }
  | { kind: 'transient'; retryAfterSeconds?: number }
  | { kind: 'network' }
  | { kind: 'unknown'; status?: number; message?: string };

export class IntegrationApiError extends Error {
  constructor(public detail: IntegrationError) {
    super(detail.kind);
  }
}
