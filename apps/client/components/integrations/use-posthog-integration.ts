import { useCallback, useEffect, useRef, useState } from 'react';
import { match, P } from 'ts-pattern';
import {
  IntegrationApiError,
  integrationsApi,
  type ConnectInput,
  type EventSummary,
  type IntegrationSummary,
} from '../../lib/api/integrations';

export type EventsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'auth_failed' }
  | { kind: 'network_error' };

export type PageState =
  | { kind: 'loading' }
  | { kind: 'disconnected'; authError: boolean }
  | { kind: 'connecting' }
  | {
      kind: 'connected';
      integration: IntegrationSummary;
      events: EventsState;
      includeAutocaptured: boolean;
      disconnecting: boolean;
      savingEvents: boolean;
    }
  | { kind: 'error'; message: string };

export function usePosthogIntegration() {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [toast, setToast] = useState<string | null>(null);
  const [eventReloadKey, setEventReloadKey] = useState(0);
  const eventRequestId = useRef(0);
  const toastTimeoutId = useRef<number | null>(null);

  const flashToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimeoutId.current !== null) {
      window.clearTimeout(toastTimeoutId.current);
    }
    toastTimeoutId.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimeoutId.current !== null) {
        window.clearTimeout(toastTimeoutId.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    integrationsApi
      .get()
      .then((integration) => {
        if (cancelled) return;
        setState(integration ? connectedState(integration) : disconnectedState());
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

  const integrationId = state.kind === 'connected' ? state.integration.id : null;
  const includeAutocaptured =
    state.kind === 'connected' ? state.includeAutocaptured : false;

  useEffect(() => {
    if (!integrationId) return;

    const requestId = eventRequestId.current + 1;
    eventRequestId.current = requestId;

    queueMicrotask(() => {
      if (eventRequestId.current !== requestId) return;
      setState((prev) =>
        prev.kind === 'connected' ? { ...prev, events: { kind: 'loading' } } : prev,
      );
    });

    integrationsApi
      .listEvents({ days: 30, limit: 100, includeAutocaptured })
      .then((events) => {
        if (eventRequestId.current !== requestId) return;
        setState((prev) =>
          prev.kind === 'connected'
            ? { ...prev, events: { kind: 'ready', events } }
            : prev,
        );
      })
      .catch((err: unknown) => {
        if (eventRequestId.current !== requestId) return;
        const next = mapEventLoadError(err);
        setState((prev) =>
          prev.kind === 'connected' ? { ...prev, events: next } : prev,
        );
        if (next.kind === 'network_error') {
          flashToast('Network error while fetching events.');
        }
      });
  }, [eventReloadKey, flashToast, includeAutocaptured, integrationId]);

  const handleConnect = useCallback((input: ConnectInput) => {
    setState({ kind: 'connecting' });
    integrationsApi
      .connect(input)
      .then(() => integrationsApi.get())
      .then((integration) => {
        if (!integration) throw new Error('integration vanished after connect');
        setState(connectedState(integration));
        setEventReloadKey((key) => key + 1);
      })
      .catch((err: unknown) => {
        if (err instanceof IntegrationApiError && err.detail.kind === 'posthog_auth_failed') {
          setState({ kind: 'disconnected', authError: true });
          return;
        }
        if (err instanceof IntegrationApiError && err.detail.kind === 'network') {
          setState(disconnectedState());
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
  }, [flashToast]);

  const handleDisconnect = useCallback(() => {
    setState((prev) => (prev.kind === 'connected' ? { ...prev, disconnecting: true } : prev));
    integrationsApi
      .disconnect()
      .then(() => setState(disconnectedState()))
      .catch(() => {
        setState((prev) =>
          prev.kind === 'connected' ? { ...prev, disconnecting: false } : prev,
        );
        flashToast("Couldn't disconnect. Try again.");
      });
  }, [flashToast]);

  const handleReconnect = useCallback(() => setState(disconnectedState()), []);

  const handleToggleAutocaptured = useCallback((next: boolean) => {
    setState((prev) =>
      prev.kind === 'connected'
        ? { ...prev, includeAutocaptured: next, events: { kind: 'idle' } }
        : prev,
    );
  }, []);

  const handleManageEvents = useCallback(() => {
    setState((prev) =>
      prev.kind === 'connected' ? { ...prev, events: { kind: 'idle' } } : prev,
    );
    setEventReloadKey((key) => key + 1);
  }, []);

  const handleSaveEventSelection = useCallback((selected: EventSummary[]) => {
    setState((prev) => (prev.kind === 'connected' ? { ...prev, savingEvents: true } : prev));
    integrationsApi
      .saveEventSelection(selected)
      .then(() => {
        setState((prev) => {
          if (prev.kind !== 'connected') return prev;
          const selectedNames = new Set(selected.map((event) => event.name));
          return {
            ...prev,
            savingEvents: false,
            events:
              prev.events.kind === 'ready'
                ? {
                    kind: 'ready',
                    events: prev.events.events.map((event) => ({
                      ...event,
                      active: selectedNames.has(event.name),
                    })),
                  }
                : prev.events,
          };
        });
        flashToast('PostHog event selection saved.');
      })
      .catch((err: unknown) => {
        setState((prev) =>
          prev.kind === 'connected' ? { ...prev, savingEvents: false } : prev,
        );
        if (err instanceof IntegrationApiError && err.detail.kind === 'posthog_auth_failed') {
          flashToast('PostHog rejected the saved API key. Reconnect and try again.');
          return;
        }
        flashToast("Couldn't save event selection. Try again.");
      });
  }, [flashToast]);

  return {
    state,
    toast,
    handleConnect,
    handleDisconnect,
    handleManageEvents,
    handleReconnect,
    handleSaveEventSelection,
    handleToggleAutocaptured,
  };
}

function connectedState(integration: IntegrationSummary): PageState {
  return {
    kind: 'connected',
    integration,
    events: { kind: 'idle' },
    includeAutocaptured: false,
    disconnecting: false,
    savingEvents: false,
  };
}

function disconnectedState(): PageState {
  return { kind: 'disconnected', authError: false };
}

function mapEventLoadError(err: unknown): EventsState {
  return match(err)
    .with(P.instanceOf(IntegrationApiError), (e) =>
      match(e.detail)
        .with({ kind: 'posthog_auth_failed' }, () => ({ kind: 'auth_failed' as const }))
        .otherwise(() => ({ kind: 'network_error' as const })),
    )
    .otherwise(() => ({ kind: 'network_error' as const }));
}
