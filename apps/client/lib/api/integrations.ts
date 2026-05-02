// Typed wrapper around `/api/integrations/posthog/*` (Chunk B).
//
// Chunk B isn't deployed yet, so we ship a mock backed by in-memory state.
// Toggle with `VITE_INTEGRATIONS_MOCK`. When unset, defaults to mock if no API
// host is configured — meaning local dev "just works" without the backend up.
//
// Swap to the real routes by setting `VITE_INTEGRATIONS_MOCK=false` (and a
// `VITE_API_URL` that points at the deployed public function). Contract source:
// docs/postdoc/connect-flow-api.md.

const CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

export type IntegrationSummary = {
  id: string;
  provider: 'posthog';
  project_id: string;
  connected_at: string;
};

export type EventSummary = {
  name: string;
  volume: number;
};

export type ConnectInput = {
  personal_api_key: string;
  project_id: string;
  region: 'us' | 'eu';
};

// 502 from the API: { code: "posthog_auth_failed" }. Anything 5xx that isn't
// auth lands here as `transient`. Network failures land as `network`.
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

const apiBase = (import.meta.env.VITE_PUBLIC_API_URL ?? '')
  .toString()
  .replace(/\/+$/, '');
const mockEnv = import.meta.env.VITE_INTEGRATIONS_MOCK;
const useMock =
  mockEnv === undefined ? apiBase === '' : String(mockEnv) === 'true';

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Customer-Id': CUSTOMER_ID,
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new IntegrationApiError({ kind: 'network' });
  }

  if (res.status === 204) return undefined as T;

  if (!res.ok) {
    let body: { code?: string; message?: string } = {};
    try {
      body = await res.json();
    } catch {
      // ignore
    }
    if (res.status === 502 && body.code === 'posthog_auth_failed') {
      throw new IntegrationApiError({ kind: 'posthog_auth_failed' });
    }
    if (res.status === 503) {
      const ra = res.headers.get('retry-after');
      throw new IntegrationApiError({
        kind: 'transient',
        retryAfterSeconds: ra ? Number(ra) : undefined,
      });
    }
    throw new IntegrationApiError({
      kind: 'unknown',
      status: res.status,
      message: body.message,
    });
  }

  return (await res.json()) as T;
}

// ---------- mock backend ----------

type MockState = {
  integration: {
    id: string;
    project_id: string;
    connected_at: string;
    personal_api_key: string;
  } | null;
};

const mock: MockState = { integration: null };

const sampleEvents: ReadonlyArray<EventSummary> = [
  { name: 'order_completed', volume: 4123 },
  { name: 'checkout_started', volume: 3870 },
  { name: 'product_viewed', volume: 3120 },
  { name: 'signup_completed', volume: 1842 },
  { name: 'trial_started', volume: 1320 },
  { name: 'subscription_renewed', volume: 1108 },
  { name: 'cart_abandoned', volume: 980 },
  { name: 'support_ticket_opened', volume: 612 },
  { name: 'feature_used_export', volume: 410 },
  { name: 'feature_used_share', volume: 388 },
  { name: 'invite_sent', volume: 221 },
  { name: 'profile_updated', volume: 174 },
];

const autocapturedEvents: ReadonlyArray<EventSummary> = [
  { name: '$pageview', volume: 21000 },
  { name: '$autocapture', volume: 18420 },
  { name: '$identify', volume: 6210 },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mockGet(): Promise<IntegrationSummary | null> {
  await sleep(150);
  if (!mock.integration) return null;
  return {
    id: mock.integration.id,
    provider: 'posthog',
    project_id: mock.integration.project_id,
    connected_at: mock.integration.connected_at,
  };
}

async function mockConnect(input: ConnectInput): Promise<{ integration_id: string }> {
  await sleep(400);
  if (input.personal_api_key.startsWith('phx_invalid')) {
    throw new IntegrationApiError({ kind: 'posthog_auth_failed' });
  }
  if (mock.integration) {
    throw new IntegrationApiError({ kind: 'unknown', status: 409 });
  }
  mock.integration = {
    id: crypto.randomUUID(),
    project_id: input.project_id,
    connected_at: new Date().toISOString(),
    personal_api_key: input.personal_api_key,
  };
  return { integration_id: mock.integration.id };
}

async function mockListEvents(opts: {
  days?: number;
  limit?: number;
  includeAutocaptured?: boolean;
}): Promise<EventSummary[]> {
  await sleep(250);
  if (!mock.integration) {
    throw new IntegrationApiError({ kind: 'unknown', status: 404 });
  }
  if (mock.integration.personal_api_key.startsWith('phx_revoked')) {
    throw new IntegrationApiError({ kind: 'posthog_auth_failed' });
  }
  const all = opts.includeAutocaptured
    ? [...sampleEvents, ...autocapturedEvents]
    : sampleEvents;
  return [...all]
    .sort((a, b) => b.volume - a.volume)
    .slice(0, opts.limit ?? 50);
}

async function mockDisconnect(): Promise<void> {
  await sleep(200);
  mock.integration = null;
}

// ---------- public API ----------

export const integrationsApi = {
  async get(): Promise<IntegrationSummary | null> {
    if (useMock) return mockGet();
    try {
      return await request<IntegrationSummary>('/api/integrations/posthog');
    } catch (err) {
      if (err instanceof IntegrationApiError && err.detail.kind === 'unknown' && err.detail.status === 404) {
        return null;
      }
      throw err;
    }
  },

  connect(input: ConnectInput): Promise<{ integration_id: string }> {
    if (useMock) return mockConnect(input);
    return request<{ integration_id: string }>('/api/integrations/posthog/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listEvents(opts: { days?: number; limit?: number; includeAutocaptured?: boolean } = {}): Promise<EventSummary[]> {
    if (useMock) return mockListEvents(opts);
    const params = new URLSearchParams();
    if (opts.days) params.set('days', String(opts.days));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.includeAutocaptured) params.set('include_autocaptured', 'true');
    const qs = params.toString();
    return request<EventSummary[]>(
      `/api/integrations/posthog/events${qs ? `?${qs}` : ''}`,
    );
  },

  disconnect(): Promise<void> {
    if (useMock) return mockDisconnect();
    return request<void>('/api/integrations/posthog', { method: 'DELETE' });
  },
};
