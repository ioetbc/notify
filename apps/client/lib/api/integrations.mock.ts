import {
  IntegrationApiError,
  type ConnectInput,
  type EventListOptions,
  type EventSummary,
  type IntegrationSummary,
} from './integrations.types';

type MockState = {
  integration: {
    id: string;
    project_id: string;
    connected_at: string;
    personal_api_key: string;
  } | null;
  selectedEvents: Set<string>;
};

const mock: MockState = { integration: null, selectedEvents: new Set() };

const sampleEvents: ReadonlyArray<EventSummary> = [
  { name: 'order_completed', volume: 4123, active: false },
  { name: 'checkout_started', volume: 3870, active: false },
  { name: 'product_viewed', volume: 3120, active: false },
  { name: 'signup_completed', volume: 1842, active: false },
  { name: 'trial_started', volume: 1320, active: false },
  { name: 'subscription_renewed', volume: 1108, active: false },
  { name: 'cart_abandoned', volume: 980, active: false },
  { name: 'support_ticket_opened', volume: 612, active: false },
  { name: 'feature_used_export', volume: 410, active: false },
  { name: 'feature_used_share', volume: 388, active: false },
  { name: 'invite_sent', volume: 221, active: false },
  { name: 'profile_updated', volume: 174, active: false },
];

const autocapturedEvents: ReadonlyArray<EventSummary> = [
  { name: '$pageview', volume: 21000, active: false },
  { name: '$autocapture', volume: 18420, active: false },
  { name: '$identify', volume: 6210, active: false },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const mockIntegrationsApi = {
  async get(): Promise<IntegrationSummary | null> {
    await sleep(150);
    if (!mock.integration) return null;
    return {
      id: mock.integration.id,
      provider: 'posthog',
      project_id: mock.integration.project_id,
      connected_at: mock.integration.connected_at,
    };
  },

  async connect(input: ConnectInput): Promise<{ integration_id: string }> {
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
  },

  async listEvents(opts: EventListOptions = {}): Promise<EventSummary[]> {
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
      .map((event) => ({ ...event, active: mock.selectedEvents.has(event.name) }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, opts.limit ?? 50);
  },

  async saveEventSelection(events: EventSummary[]): Promise<{ event_names: string[] }> {
    await sleep(300);
    if (!mock.integration) {
      throw new IntegrationApiError({ kind: 'unknown', status: 404 });
    }
    mock.selectedEvents = new Set(events.map((event) => event.name));
    return { event_names: [...mock.selectedEvents] };
  },

  async disconnect(): Promise<void> {
    await sleep(200);
    mock.integration = null;
    mock.selectedEvents.clear();
  },
};
