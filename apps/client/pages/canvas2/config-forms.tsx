import type { WaitConfig, BranchConfig, SendConfig, FilterConfig } from './types';
import type { UserColumn } from './hooks';

export function WaitConfigForm({
  config,
  onUpdate,
}: {
  config: WaitConfig;
  onUpdate: (config: WaitConfig) => void;
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

export function BranchConfigForm({
  config,
  onUpdate,
  userColumns,
}: {
  config: BranchConfig;
  onUpdate: (config: BranchConfig) => void;
  userColumns: UserColumn[];
}) {
  const operators = ['=', '!=', 'exists', 'not_exists'] as const;
  const needsValue = config.operator === '=' || config.operator === '!=';

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
            <option key={col.name} value={col.name}>
              {col.name}
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
      {needsValue && config.user_column && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">Compare Value</label>
          <input
            type="text"
            value={config.compare_value || ''}
            onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
            className="w-full border border-gray-300 rounded px-3 py-2"
            placeholder="Enter value"
          />
        </div>
      )}
    </div>
  );
}

export function SendConfigForm({
  config,
  onUpdate,
}: {
  config: SendConfig;
  onUpdate: (config: SendConfig) => void;
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

export function FilterConfigForm({
  config,
  onUpdate,
  userColumns,
}: {
  config: FilterConfig;
  onUpdate: (config: FilterConfig) => void;
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
      <div>
        <label className="block text-sm text-gray-700 mb-1">Attribute</label>
        <select
          value={config.attribute_key}
          onChange={(e) => onUpdate({ ...config, attribute_key: e.target.value, compare_value: '' })}
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Select an attribute...</option>
          {userColumns.map((col) => (
            <option key={col.name} value={col.name}>
              {col.name}
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
      {config.attribute_key && selectedColumn && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">Value</label>
          <select
            value={String(config.compare_value ?? '')}
            onChange={(e) => onUpdate({ ...config, compare_value: parseValue(e.target.value) })}
            className="w-full border border-gray-300 rounded px-3 py-2"
          >
            <option value="">Select a value...</option>
            {selectedColumn.values.map((val) => (
              <option key={val} value={val}>
                {val}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
