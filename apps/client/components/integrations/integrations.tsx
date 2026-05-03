import { Link } from 'react-router-dom';
import { match } from 'ts-pattern';
import type { EventSummary } from '../../lib/api/integrations';
import { ConnectForm } from './connect-form';
import { EventPicker } from './event-picker';
import { ConnectedState } from './connected-state';
import { usePosthogIntegration, type EventsState } from './use-posthog-integration';

export function IntegrationsPage() {
  const {
    state,
    toast,
    handleConnect,
    handleDisconnect,
    handleManageEvents,
    handleReconnect,
    handleSaveEventSelection,
    handleToggleAutocaptured,
  } = usePosthogIntegration();

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
              <h2 className="text-sm font-semibold text-text-primary">PostHog events</h2>
              <EventPicker
                status={mapEventsStatus(s.events)}
                includeAutocaptured={s.includeAutocaptured}
                saving={s.savingEvents}
                onToggleAutocaptured={handleToggleAutocaptured}
                onReconnect={handleReconnect}
                onSaveSelection={handleSaveEventSelection}
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
