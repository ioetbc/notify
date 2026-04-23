import type {
  TriggerEvent,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  StepNodeData,
} from './types';
import type { CanvasNode, UserColumn } from './utils';
import { formatTriggerEvent, TRIGGER_EVENTS } from './utils';

interface ConfigPanelProps {
  node: CanvasNode;
  onUpdate: (config: TriggerNodeData['config'] | WaitNodeData['config'] | BranchNodeData['config'] | SendNodeData['config']) => void;
  onClose: () => void;
  userColumns: UserColumn[];
}

export function ConfigPanel({ node, onUpdate, onClose, userColumns }: ConfigPanelProps) {
  const data = node.data;

  return (
    <div className="w-72 border-l border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 capitalize">{data.type} Step</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      {data.type === 'trigger' && (
        <TriggerConfig config={data.config} onUpdate={onUpdate} />
      )}
      {data.type === 'wait' && (
        <WaitConfig config={data.config} onUpdate={onUpdate} />
      )}
      {data.type === 'branch' && (
        <BranchConfig config={data.config} onUpdate={onUpdate} userColumns={userColumns} />
      )}
      {data.type === 'send' && (
        <SendConfig config={data.config} onUpdate={onUpdate} />
      )}
    </div>
  );
}

function TriggerConfig({
  config,
  onUpdate,
}: {
  config: TriggerNodeData['config'];
  onUpdate: (config: TriggerNodeData['config']) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">Trigger Event</label>
      <select
        value={config.event}
        onChange={(e) => onUpdate({ event: e.target.value as TriggerEvent })}
        className="w-full border border-gray-300 rounded px-3 py-2"
      >
        {TRIGGER_EVENTS.map((event) => (
          <option key={event} value={event}>
            {formatTriggerEvent(event)}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500 mt-2">
        This workflow will start when this event occurs.
      </p>
    </div>
  );
}

function WaitConfig({
  config,
  onUpdate,
}: {
  config: WaitNodeData['config'];
  onUpdate: (config: WaitNodeData['config']) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">Wait Duration (hours)</label>
      <input
        type="number"
        value={config.hours}
        onChange={(e) => onUpdate({ hours: parseInt(e.target.value, 10) || 1 })}
        min={1}
        max={720}
        className="w-full border border-gray-300 rounded px-3 py-2"
      />
      <p className="text-xs text-gray-500 mt-1">
        {config.hours >= 24
          ? `= ${Math.floor(config.hours / 24)} days ${config.hours % 24} hours`
          : `= ${config.hours} hours`}
      </p>
    </div>
  );
}

function BranchConfig({
  config,
  onUpdate,
  userColumns,
}: {
  config: BranchNodeData['config'];
  onUpdate: (config: BranchNodeData['config']) => void;
  userColumns: UserColumn[];
}) {
  const operators = ['=', '!=', 'exists', 'not_exists'] as const;
  const needsValue = config.operator === '=' || config.operator === '!=';

  const selectedAttribute = userColumns.find((col) => col.name === config.user_column);
  const dataType = selectedAttribute?.dataType;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1">Attribute</label>
        <select
          value={config.user_column}
          onChange={(e) => onUpdate({ ...config, user_column: e.target.value, compare_value: '' })}
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Select an attribute...</option>
          {userColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.name} ({col.dataType})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Operator</label>
        <select
          value={config.operator}
          onChange={(e) =>
            onUpdate({ ...config, operator: e.target.value as typeof config.operator })
          }
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>
      {needsValue && selectedAttribute && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">Compare Value</label>
          {dataType === 'boolean' && (
            <select
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">Select...</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          )}
          {dataType === 'number' && (
            <input
              type="number"
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Enter a number"
            />
          )}
          {dataType === 'text' && (
            <input
              type="text"
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Enter text"
            />
          )}
        </div>
      )}
    </div>
  );
}

function SendConfig({
  config,
  onUpdate,
}: {
  config: SendNodeData['config'];
  onUpdate: (config: SendNodeData['config']) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Title <span className="text-gray-400">({config.title.length}/50)</span>
        </label>
        <input
          type="text"
          value={config.title}
          onChange={(e) => onUpdate({ ...config, title: e.target.value.slice(0, 50) })}
          maxLength={50}
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Body <span className="text-gray-400">({config.body.length}/150)</span>
        </label>
        <textarea
          value={config.body}
          onChange={(e) => onUpdate({ ...config, body: e.target.value.slice(0, 150) })}
          maxLength={150}
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>
    </div>
  );
}
