import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Clock, GitBranch, Bell, Zap, Filter } from 'lucide-react';
import type { TriggerNodeData, WaitNodeData, BranchNodeData, SendNodeData, FilterNodeData } from './types';

const baseNodeStyles = 'px-4 py-3 rounded-lg border-2 shadow-sm min-w-[150px]';

type TriggerNode = Node<TriggerNodeData, 'trigger'>;
type WaitNode = Node<WaitNodeData, 'wait'>;
type BranchNode = Node<BranchNodeData, 'branch'>;
type SendNode = Node<SendNodeData, 'send'>;

const systemEventLabels: Record<string, string> = {
  user_created: 'User Created',
  user_updated: 'User Updated',
};

export function TriggerNode({ data, selected }: NodeProps<TriggerNode>) {
  const eventLabel = data.config.triggerType === 'system'
    ? (systemEventLabels[data.config.event] || data.config.event)
    : data.config.event;

  return (
    <div
      className={`${baseNodeStyles} bg-green-50 border-green-300 ${
        selected ? 'ring-2 ring-green-500' : ''
      }`}
    >
      <div className="flex items-center gap-2">
        <Zap className="w-4 h-4 text-green-600" />
        <div>
          <div className="text-xs text-green-600 font-medium">Trigger</div>
          <div className="text-sm font-semibold text-green-800">{eventLabel}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-green-500" />
    </div>
  );
}

export function WaitNode({ data, selected }: NodeProps<WaitNode>) {
  const hours = data.config.hours;
  const displayTime = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;

  return (
    <div
      className={`${baseNodeStyles} bg-amber-50 border-amber-300 ${
        selected ? 'ring-2 ring-amber-500' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-amber-500" />
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-amber-600" />
        <div>
          <div className="text-xs text-amber-600 font-medium">Wait</div>
          <div className="text-sm font-semibold text-amber-800">{displayTime}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-500" />
    </div>
  );
}

export function BranchNode({ data, selected }: NodeProps<BranchNode>) {
  const { user_column, operator, compare_value } = data.config;
  const needsValue = operator === '=' || operator === '!=';

  let conditionText = 'Configure condition...';
  if (user_column) {
    conditionText = needsValue
      ? `${user_column} ${operator} "${compare_value || ''}"`
      : `${user_column} ${operator}`;
  }

  return (
    <div
      className={`${baseNodeStyles} bg-purple-50 border-purple-300 ${
        selected ? 'ring-2 ring-purple-500' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-purple-500" />
      <div className="flex items-center gap-2">
        <GitBranch className="w-4 h-4 text-purple-600" />
        <div>
          <div className="text-xs text-purple-600 font-medium">Branch</div>
          <div className="text-sm font-semibold text-purple-800 max-w-[180px] truncate">
            {conditionText}
          </div>
        </div>
      </div>
      <div className="flex justify-between mt-2 text-xs">
        <div className="relative">
          <Handle
            type="source"
            position={Position.Bottom}
            id="yes"
            className="!bg-green-500 !left-0"
            style={{ left: 10 }}
          />
          <span className="text-green-600 font-medium">Yes</span>
        </div>
        <div className="relative">
          <Handle
            type="source"
            position={Position.Bottom}
            id="no"
            className="!bg-red-500 !right-0"
            style={{ left: 'auto', right: 10 }}
          />
          <span className="text-red-600 font-medium">No</span>
        </div>
      </div>
    </div>
  );
}

export function SendNode({ data, selected }: NodeProps<SendNode>) {
  const { title, body } = data.config;

  return (
    <div
      className={`${baseNodeStyles} bg-blue-50 border-blue-300 ${
        selected ? 'ring-2 ring-blue-500' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-blue-500" />
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-blue-600" />
        <div>
          <div className="text-xs text-blue-600 font-medium">Send</div>
          <div className="text-sm font-semibold text-blue-800 max-w-[180px] truncate">
            {title || 'Untitled'}
          </div>
          {body && (
            <div className="text-xs text-blue-600 max-w-[180px] truncate">{body}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </div>
  );
}

type FilterNode = Node<FilterNodeData, 'filter'>;

export function FilterNode({ data, selected }: NodeProps<FilterNode>) {
  const { attribute_key, operator, compare_value } = data.config;

  let conditionText = 'Configure filter...';
  if (attribute_key) {
    conditionText = `${attribute_key} ${operator} ${JSON.stringify(compare_value)}`;
  }

  return (
    <div
      className={`${baseNodeStyles} bg-orange-50 border-orange-300 ${
        selected ? 'ring-2 ring-orange-500' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-orange-500" />
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-orange-600" />
        <div>
          <div className="text-xs text-orange-600 font-medium">Filter</div>
          <div className="text-sm font-semibold text-orange-800 max-w-[180px] truncate">
            {conditionText}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-orange-500" />
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  wait: WaitNode,
  branch: BranchNode,
  send: SendNode,
  filter: FilterNode,
};
