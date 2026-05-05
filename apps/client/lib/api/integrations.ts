import {
  IntegrationApiError,
  type ConnectInput,
  type EventListOptions,
  type EventSummary,
  type IntegrationSummary,
} from './integrations.types';

export {
  IntegrationApiError,
  type ConnectInput,
  type EventListOptions,
  type EventSummary,
  type IntegrationError,
  type IntegrationSummary,
} from './integrations.types';

const CUSTOMER_ID = '00000000-0000-0000-0000-000000000001';

const apiBase = (import.meta.env.VITE_PUBLIC_API_URL ?? '')
  .toString()
  .replace(/\/+$/, '');

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
      // Some upstream errors return empty or non-JSON bodies.
    }
    if (res.status === 502 && body.code === 'posthog_auth_failed') {
      throw new IntegrationApiError({ kind: 'posthog_auth_failed' });
    }
    if (res.status === 503) {
      const retryAfter = res.headers.get('retry-after');
      throw new IntegrationApiError({
        kind: 'transient',
        retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
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

export const integrationsApi = {
  async get(): Promise<IntegrationSummary | null> {
    try {
      return await request<IntegrationSummary>('/api/integrations/posthog');
    } catch (err) {
      if (
        err instanceof IntegrationApiError &&
        err.detail.kind === 'unknown' &&
        err.detail.status === 404
      ) {
        return null;
      }
      throw err;
    }
  },

  connect(input: ConnectInput): Promise<{ integration_id: string }> {
    return request<{ integration_id: string }>('/api/integrations/posthog/connect', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  listEvents(opts: EventListOptions = {}): Promise<EventSummary[]> {
    const params = new URLSearchParams();
    if (opts.days) params.set('days', String(opts.days));
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.includeAutocaptured) params.set('include_autocaptured', 'true');
    const qs = params.toString();
    return request<EventSummary[]>(
      `/api/integrations/posthog/events${qs ? `?${qs}` : ''}`,
    );
  },

  saveEventSelection(events: EventSummary[]): Promise<{ event_names: string[] }> {
    return request<{ event_names: string[] }>('/api/integrations/posthog/events/selection', {
      method: 'POST',
      body: JSON.stringify({
        events: events.map((event) => ({
          name: event.name,
          volume: event.volume,
        })),
      }),
    });
  },

  disconnect(): Promise<void> {
    return request<void>('/api/integrations/posthog', { method: 'DELETE' });
  },
};
