import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { match, P } from 'ts-pattern';
import {
  IntegrationApiError,
  integrationsApi,
  type EventSummary,
  type IntegrationSummary,
} from '../../lib/api/integrations';
import { ConnectForm } from './connect-form';
import { EventPicker } from './event-picker';
import { ConnectedState } from './connected-state';

type EventsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'auth_failed' }
  | { kind: 'network_error' };

type PageState =
  | { kind: 'loading' }
  | { kind: 'disconnected'; authError: boolean }
  | { kind: 'connecting' }
  | {
      kind: 'connected';
      integration: IntegrationSummary;
      events: EventsState;
      includeAutocaptured: boolean;
      disconnecting: boolean;
    }
  | { kind: 'error'; message: string };

export function IntegrationsPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [toast, setToast] = useState<string | null>(null);

  const flashToast = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Initial fetch of "do I have an integration?"
  useEffect(() => {
    let cancelled = false;
    integrationsApi
      .get()
      .then((integration) => {
        if (cancelled) return;
        if (integration) {
          setState({
            kind: 'connected',
            integration,
            events: { kind: 'idle' },
            includeAutocaptured: false,
            disconnecting: false,
          });
        } else {
          setState({ kind: 'disconnected', authError: false });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message:
            err instanceof IntegrationApiError
              ? `Couldn't load integration (${err.detail.kind})`
              : "Couldn't load integration",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isConnected = state.kind === 'connected';
  const includeAutocaptured = state.kind === 'connected' ? state.includeAutocaptured : false;
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!isConnected) {
      inFlightRef.current = false;
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setState((prev) =>
      prev.kind === 'connected' ? { ...prev, events: { kind: 'loading' } } : prev,
    );

    integrationsApi
      .listEvents({ days: 30, limit: 100, includeAutocaptured })
      .then((events) => {
        inFlightRef.current = false;
        setState((prev) =>
          prev.kind === 'connected'
            ? { ...prev, events: { kind: 'ready', events } }
            : prev,
        );
      })
      .catch((err: unknown) => {
        inFlightRef.current = false;
        const next: EventsState = match(err)
          .with(P.instanceOf(IntegrationApiError), (e) =>
            match(e.detail)
              .with({ kind: 'posthog_auth_failed' }, () => ({ kind: 'auth_failed' as const }))
              .with({ kind: 'network' }, () => ({ kind: 'network_error' as const }))
              .otherwise(() => ({ kind: 'network_error' as const })),
          )
          .otherwise(() => ({ kind: 'network_error' as const }));
        setState((prev) =>
          prev.kind === 'connected' ? { ...prev, events: next } : prev,
        );
        if (next.kind === 'network_error') {
          flashToast('Network error while fetching events.');
        }
      });
  }, [isConnected, includeAutocaptured, flashToast]);

  const handleConnect = (input: { personal_api_key: string; project_id: string; region: 'us' | 'eu' }) => {
    setState({ kind: 'connecting' });
    integrationsApi
      .connect(input)
      .then(() => integrationsApi.get())
      .then((integration) => {
        if (!integration) throw new Error('integration vanished after connect');
        setState({
          kind: 'connected',
          integration,
          events: { kind: 'idle' },
          includeAutocaptured: false,
          disconnecting: false,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof IntegrationApiError && err.detail.kind === 'posthog_auth_failed') {
          setState({ kind: 'disconnected', authError: true });
          return;
        }
        if (err instanceof IntegrationApiError && err.detail.kind === 'network') {
          setState({ kind: 'disconnected', authError: false });
          flashToast('Network error. Try again.');
          return;
        }
        setState({
          kind: 'error',
          message:
            err instanceof IntegrationApiError
              ? `Connect failed (${err.detail.kind})`
              : 'Connect failed',
        });
      });
  };

  const handleDisconnect = () => {
    if (state.kind !== 'connected') return;
    setState({ ...state, disconnecting: true });
    integrationsApi
      .disconnect()
      .then(() => setState({ kind: 'disconnected', authError: false }))
      .catch(() => {
        setState((prev) =>
          prev.kind === 'connected' ? { ...prev, disconnecting: false } : prev,
        );
        flashToast("Couldn't disconnect. Try again.");
      });
  };

  const handleReconnect = () => setState({ kind: 'disconnected', authError: false });

  const handleToggleAutocaptured = (next: boolean) => {
    setState((prev) =>
      prev.kind === 'connected'
        ? { ...prev, includeAutocaptured: next, events: { kind: 'idle' } }
        : prev,
    );
  };

  const handleManageEvents = () => {
    setState((prev) =>
      prev.kind === 'connected' ? { ...prev, events: { kind: 'idle' } } : prev,
    );
  };

  const handleCreateWorkflows = (_selected: string[]) => {
    flashToast('Starter workflow creation is coming soon — selection logged to console.');
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <Link to="/" className="text-sm text-primary hover:text-primary-hover">
        ← Back to Home
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-base font-semibold text-text-primary">Integrations · PostHog</h1>
        <p className="text-sm text-gray-500">
          Send PostHog events into Notify to trigger journeys without double-instrumenting.
        </p>
      </header>

      {match(state)
        .with({ kind: 'loading' }, () => (
          <p className="text-sm text-gray-500">Loading…</p>
        ))
        .with({ kind: 'disconnected' }, ({ authError }) => (
          <ConnectForm submitting={false} authError={authError} onSubmit={handleConnect} />
        ))
        .with({ kind: 'connecting' }, () => (
          <ConnectForm submitting={true} authError={false} onSubmit={handleConnect} />
        ))
        .with({ kind: 'connected' }, (s) => (
          <div className="flex flex-col gap-8">
            <ConnectedState
              integration={s.integration}
              disconnecting={s.disconnecting}
              onDisconnect={handleDisconnect}
              onManageEvents={handleManageEvents}
            />
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-text-primary">Pick events for starter workflows</h2>
              <EventPicker
                status={mapEventsStatus(s.events)}
                includeAutocaptured={s.includeAutocaptured}
                onToggleAutocaptured={handleToggleAutocaptured}
                onReconnect={handleReconnect}
                onCreateWorkflows={handleCreateWorkflows}
              />
            </section>
          </div>
        ))
        .with({ kind: 'error' }, ({ message }) => (
          <p className="text-sm text-red-600">{message}</p>
        ))
        .exhaustive()}

      {toast && (
        <div className="fixed bottom-6 right-6 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function mapEventsStatus(s: EventsState):
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'auth_failed' }
  | { kind: 'network_error' } {
  return match(s)
    .with({ kind: 'idle' }, () => ({ kind: 'loading' as const }))
    .with({ kind: 'loading' }, () => ({ kind: 'loading' as const }))
    .with({ kind: 'ready' }, ({ events }) => ({ kind: 'ready' as const, events }))
    .with({ kind: 'auth_failed' }, () => ({ kind: 'auth_failed' as const }))
    .with({ kind: 'network_error' }, () => ({ kind: 'network_error' as const }))
    .exhaustive();
}
