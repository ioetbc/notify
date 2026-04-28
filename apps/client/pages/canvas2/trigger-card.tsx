import { Zap } from 'lucide-react';
import type { TriggerData, TriggerType } from './types';

const SYSTEM_EVENTS = ['user_created', 'user_updated'] as const;

interface TriggerCardProps {
  trigger: TriggerData;
  eventNames: string[];
  onChange: (trigger: TriggerData) => void;
}

export function TriggerCard({ trigger, eventNames, onChange }: TriggerCardProps) {
  return (
    <div className="px-4 py-3 rounded-lg border-2 border-green-300 bg-green-50 w-[260px] mx-auto">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-green-600" />
        <div className="text-xs font-medium text-green-600">Trigger</div>
      </div>

      <label className="block text-xs text-green-800 mb-1">Type</label>
      <select
        value={trigger.triggerType}
        onChange={(e) => {
          const triggerType = e.target.value as TriggerType;
          const event =
            triggerType === 'system' ? SYSTEM_EVENTS[0] : eventNames[0] ?? '';
          onChange({ triggerType, event });
        }}
        className="w-full mb-2 border border-green-300 rounded px-2 py-1 text-sm bg-white"
      >
        <option value="system">System</option>
        <option value="custom">Custom Event</option>
      </select>

      <label className="block text-xs text-green-800 mb-1">Event</label>
      {trigger.triggerType === 'system' ? (
        <select
          value={trigger.event}
          onChange={(e) => onChange({ ...trigger, event: e.target.value })}
          className="w-full border border-green-300 rounded px-2 py-1 text-sm bg-white"
        >
          {SYSTEM_EVENTS.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>
      ) : (
        <select
          value={trigger.event}
          onChange={(e) => onChange({ ...trigger, event: e.target.value })}
          className="w-full border border-green-300 rounded px-2 py-1 text-sm bg-white"
        >
          {eventNames.length === 0 ? (
            <option value="" disabled>
              No events tracked yet
            </option>
          ) : (
            eventNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))
          )}
        </select>
      )}
    </div>
  );
}
