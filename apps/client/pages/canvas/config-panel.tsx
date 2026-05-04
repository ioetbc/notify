import { useState } from 'react';
import { match } from 'ts-pattern';
import { ConfigModal } from '@/components/ui/config-modal';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  TriggerType,
  TriggerEvent,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  FilterNodeData,
} from './types';
import type { CanvasNode, UserColumn } from './utils';
import { formatTriggerEvent, SYSTEM_EVENTS } from './utils';
import type { EventDefinition } from './hooks';

interface ConfigPanelProps {
  node: CanvasNode;
  onUpdate: (config: TriggerNodeData['config'] | WaitNodeData['config'] | BranchNodeData['config'] | SendNodeData['config'] | FilterNodeData['config']) => void;
  onClose: () => void;
  userColumns: UserColumn[];
  eventDefinitions: EventDefinition[];
}

export function ConfigPanel({ node, onUpdate, onClose, userColumns, eventDefinitions }: ConfigPanelProps) {
  const data = node.data;
  const [draft, setDraft] = useState(data.config);
  const title = `${data.type.charAt(0).toUpperCase()}${data.type.slice(1)} Step`;
  const isExit = data.type === 'exit';

  function handleSave() {
    onUpdate(draft as Parameters<typeof onUpdate>[0]);
    onClose();
  }

  return (
    <ConfigModal
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={title}
    >
      {match(data)
        .with({ type: 'trigger' }, () => (
          <TriggerConfig
            config={draft as TriggerNodeData['config']}
            onChange={(c) => setDraft(c)}
            eventDefinitions={eventDefinitions}
          />
        ))
        .with({ type: 'wait' }, () => (
          <WaitConfig
            config={draft as WaitNodeData['config']}
            onChange={(c) => setDraft(c)}
          />
        ))
        .with({ type: 'branch' }, () => (
          <BranchConfig
            config={draft as BranchNodeData['config']}
            onChange={(c) => setDraft(c)}
            userColumns={userColumns}
          />
        ))
        .with({ type: 'send' }, () => (
          <SendConfig
            config={draft as SendNodeData['config']}
            onChange={(c) => setDraft(c)}
          />
        ))
        .with({ type: 'filter' }, () => (
          <FilterConfig
            config={draft as FilterNodeData['config']}
            onChange={(c) => setDraft(c)}
            userColumns={userColumns}
          />
        ))
        .with({ type: 'exit' }, () => (
          <p className="text-sm text-gray-500">
            This step ends the workflow early. The enrollment will be marked as exited.
          </p>
        ))
        .exhaustive()}

      {!isExit && (
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      )}
    </ConfigModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function TriggerConfig({
  config,
  onChange,
  eventDefinitions,
}: {
  config: TriggerNodeData['config'];
  onChange: (config: TriggerNodeData['config']) => void;
  eventDefinitions: EventDefinition[];
}) {
  const customEvents = eventDefinitions.filter((d) => d.enabledAsTrigger);

  return (
    <div className="space-y-3">
      <Field label="Trigger Type">
        <Select
          value={config.triggerType}
          onValueChange={(v) => {
            const triggerType = v as TriggerType;
            const event = triggerType === 'system' ? SYSTEM_EVENTS[0] : (customEvents[0]?.name ?? '');
            onChange({ triggerType, event });
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="custom">Custom Event</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field label="Event">
        {config.triggerType === 'system' ? (
          <Select
            value={config.event}
            onValueChange={(v) => onChange({ ...config, event: v as TriggerEvent })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SYSTEM_EVENTS.map((event) => (
                <SelectItem key={event} value={event}>
                  {formatTriggerEvent(event)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : customEvents.length === 0 ? (
          <p className="text-sm text-gray-500">No events tracked yet</p>
        ) : (
          <Select
            value={config.event}
            onValueChange={(v) => onChange({ ...config, event: v as TriggerEvent })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {customEvents.map((def) => (
                <SelectItem key={def.id} value={def.name}>
                  {formatTriggerEvent(def.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <p className="text-xs text-gray-500">
        {config.triggerType === 'system'
          ? 'This workflow will start when this system event occurs.'
          : 'Select a custom event that your app has previously tracked.'}
      </p>
    </div>
  );
}

function WaitConfig({
  config,
  onChange,
}: {
  config: WaitNodeData['config'];
  onChange: (config: WaitNodeData['config']) => void;
}) {
  return (
    <Field label="Wait Duration (hours)">
      <Input
        type="number"
        value={config.hours}
        onChange={(e) => onChange({ hours: parseInt(e.target.value, 10) || 1 })}
        min={1}
        max={720}
      />
      <p className="text-xs text-gray-500">
        {config.hours >= 24
          ? `= ${Math.floor(config.hours / 24)} days ${config.hours % 24} hours`
          : `= ${config.hours} hours`}
      </p>
    </Field>
  );
}

function BranchConfig({
  config,
  onChange,
  userColumns,
}: {
  config: BranchNodeData['config'];
  onChange: (config: BranchNodeData['config']) => void;
  userColumns: UserColumn[];
}) {
  const operators = ['=', '!=', 'exists', 'not_exists'] as const;
  const needsValue = config.operator === '=' || config.operator === '!=';

  return (
    <div className="space-y-3">
      <Field label="Attribute">
        <Select
          value={config.user_column}
          onValueChange={(v) => onChange({ ...config, user_column: v, compare_value: '' })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an attribute..." />
          </SelectTrigger>
          <SelectContent>
            {userColumns.map((col) => (
              <SelectItem key={col.name} value={col.name}>
                {col.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Operator">
        <Select
          value={config.operator}
          onValueChange={(v) => onChange({ ...config, operator: v as typeof config.operator })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {needsValue && config.user_column && (
        <Field label="Compare Value">
          <Input
            type="text"
            value={config.compare_value || ''}
            onChange={(e) => onChange({ ...config, compare_value: e.target.value })}
            placeholder="Enter value"
          />
        </Field>
      )}
    </div>
  );
}

function SendConfig({
  config,
  onChange,
}: {
  config: SendNodeData['config'];
  onChange: (config: SendNodeData['config']) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label={`Title (${config.title.length}/50)`}>
        <Input
          type="text"
          value={config.title}
          onChange={(e) => onChange({ ...config, title: e.target.value.slice(0, 50) })}
          maxLength={50}
        />
      </Field>
      <Field label={`Body (${config.body.length}/150)`}>
        <Textarea
          value={config.body}
          onChange={(e) => onChange({ ...config, body: e.target.value.slice(0, 150) })}
          maxLength={150}
          rows={3}
        />
      </Field>
    </div>
  );
}

function FilterConfig({
  config,
  onChange,
  userColumns,
}: {
  config: FilterNodeData['config'];
  onChange: (config: FilterNodeData['config']) => void;
  userColumns: UserColumn[];
}) {
  const operators = ['=', '!=', '>', '<'] as const;
  const selectedColumn = userColumns.find((col) => col.name === config.attribute_key);

  function parseValue(raw: string): string | number | boolean {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw !== '' && !isNaN(Number(raw))) return Number(raw);
    return raw;
  }

  return (
    <div className="space-y-3">
      <Field label="Attribute">
        <Select
          value={config.attribute_key}
          onValueChange={(v) => onChange({ ...config, attribute_key: v, compare_value: '' })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select an attribute..." />
          </SelectTrigger>
          <SelectContent>
            {userColumns.map((col) => (
              <SelectItem key={col.name} value={col.name}>
                {col.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Operator">
        <Select
          value={config.operator}
          onValueChange={(v) => onChange({ ...config, operator: v as typeof config.operator })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {config.attribute_key && selectedColumn && (
        <Field label="Value">
          <Select
            value={String(config.compare_value ?? '')}
            onValueChange={(v) => onChange({ ...config, compare_value: parseValue(v) })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a value..." />
            </SelectTrigger>
            <SelectContent>
              {selectedColumn.values.map((val) => (
                <SelectItem key={val} value={val}>
                  {val}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    </div>
  );
}
