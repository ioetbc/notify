import { useMemo, useState } from 'react';
import { match } from 'ts-pattern';
import { Button } from '../../components/ui/button';
import type { EventSummary } from '../../lib/api/integrations';

const TOP_VISIBLE = 10;
const MIN_CUSTOM_EVENTS = 5;

type Status =
  | { kind: 'loading' }
  | { kind: 'ready'; events: EventSummary[] }
  | { kind: 'auth_failed' }
  | { kind: 'network_error' };

export type EventPickerProps = {
  status: Status;
  includeAutocaptured: boolean;
  onToggleAutocaptured: (next: boolean) => void;
  onReconnect: () => void;
  onCreateWorkflows: (selected: string[]) => void;
};

export function EventPicker(props: EventPickerProps) {
  return match(props.status)
    .with({ kind: 'loading' }, () => (
      <p className="text-sm text-gray-500">Loading events from PostHog…</p>
    ))
    .with({ kind: 'auth_failed' }, () => (
      <div className="flex max-w-lg flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">
          PostHog rejected the saved API key. The key may have been revoked or rotated.
        </p>
        <div>
          <Button variant="outline" onClick={props.onReconnect}>
            Reconnect PostHog
          </Button>
        </div>
      </div>
    ))
    .with({ kind: 'network_error' }, () => (
      <p className="text-sm text-gray-500">Couldn't reach the API. Check your connection and retry.</p>
    ))
    .with({ kind: 'ready' }, ({ events }) => (
      <ReadyPicker
        events={events}
        includeAutocaptured={props.includeAutocaptured}
        onToggleAutocaptured={props.onToggleAutocaptured}
        onCreateWorkflows={props.onCreateWorkflows}
      />
    ))
    .exhaustive();
}

function ReadyPicker({
  events,
  includeAutocaptured,
  onToggleAutocaptured,
  onCreateWorkflows,
}: {
  events: EventSummary[];
  includeAutocaptured: boolean;
  onToggleAutocaptured: (next: boolean) => void;
  onCreateWorkflows: (selected: string[]) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(
    () => [...events].sort((a, b) => b.volume - a.volume),
    [events],
  );

  const customCount = useMemo(
    () => events.filter((e) => !e.name.startsWith('$')).length,
    [events],
  );

  const visible = showAll ? sorted : sorted.slice(0, TOP_VISIBLE);
  const remainingCount = Math.max(0, sorted.length - TOP_VISIBLE);

  const toggleSelected = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleCreate = () => {
    // TODO: replace with real workflow-creation endpoint once the backend
    // exposes one. Tracked in the PostHog integration RFC ("Template picker
    // UX"). For v1 we log the selection so the UI can ship independently.
    const selectedNames = sorted
      .filter((e) => selected.has(e.name))
      .map((e) => e.name);
    console.log('[integrations] starter workflows requested for events:', selectedNames);
    onCreateWorkflows(selectedNames);
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {customCount < MIN_CUSTOM_EVENTS && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          We only see a handful of custom events in PostHog so far. Make sure you've sent events
          (anything that isn't a default <code>$</code>-prefixed event) before picking templates.
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={includeAutocaptured}
          onChange={(e) => onToggleAutocaptured(e.target.checked)}
        />
        Show all events (including autocaptured)
      </label>

      <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-200">
        {visible.map((event) => {
          const checked = selected.has(event.name);
          return (
            <li key={event.name} className="flex items-center gap-3 px-3 py-2">
              <input
                id={`event-${event.name}`}
                type="checkbox"
                checked={checked}
                onChange={() => toggleSelected(event.name)}
              />
              <label
                htmlFor={`event-${event.name}`}
                className="flex-1 cursor-pointer font-mono text-sm text-gray-900"
              >
                {event.name}
              </label>
              <span className="tabular-nums text-right text-sm text-gray-500">
                {event.volume.toLocaleString()}
              </span>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-3 py-4 text-sm text-gray-500">No events to show.</li>
        )}
      </ul>

      {!showAll && remainingCount > 0 && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
            Show {remainingCount} more
          </Button>
        </div>
      )}

      <div>
        <Button onClick={handleCreate} disabled={selected.size === 0}>
          Create {selected.size} starter workflow{selected.size === 1 ? '' : 's'}
        </Button>
      </div>
    </div>
  );
}
