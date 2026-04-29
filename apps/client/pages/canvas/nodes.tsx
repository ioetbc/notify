import { Handle, Position, useReactFlow, type NodeProps, type Node } from '@xyflow/react';
import { Clock, GitBranch, Bell, Zap, Filter, LogOut, Trash2, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  FilterNodeData,
  StepType,
} from './types';

const baseNodeStyles = 'px-4 py-3 rounded-2xl border border-gray-300 bg-white min-w-[150px]';

const systemEventLabels: Record<string, string> = {
  user_created: 'User Created',
  user_updated: 'User Updated',
};

type VariantConfig = {
  icon: LucideIcon;
  label: string;
  iconBg: string;
  iconColor: string;
  hasTarget: boolean;
  hasSource: boolean;
  getSubtitle: (data: StepNodeData) => { title: string; body?: string };
};

export const variantConfig: Record<StepType, VariantConfig> = {
  trigger: {
    icon: Zap,
    label: 'Trigger',
    iconBg: 'bg-amber-100',
    iconColor: 'text-amber-700',
    hasTarget: false,
    hasSource: true,
    getSubtitle: (data) => {
      const d = data as TriggerNodeData;
      const title =
        d.config.triggerType === 'system'
          ? systemEventLabels[d.config.event] || d.config.event
          : d.config.event;
      return { title };
    },
  },
  wait: {
    icon: Clock,
    label: 'Wait',
    iconBg: 'bg-sky-100',
    iconColor: 'text-sky-700',
    hasTarget: true,
    hasSource: true,
    getSubtitle: (data) => {
      const { hours } = (data as WaitNodeData).config;
      const title = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
      return { title };
    },
  },
  branch: {
    icon: GitBranch,
    label: 'Branch',
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-700',
    hasTarget: true,
    hasSource: false,
    getSubtitle: (data) => {
      const { user_column, operator, compare_value } = (data as BranchNodeData).config;
      const needsValue = operator === '=' || operator === '!=';
      if (!user_column) return { title: 'Configure condition...' };
      return {
        title: needsValue
          ? `${user_column} ${operator} "${compare_value || ''}"`
          : `${user_column} ${operator}`,
      };
    },
  },
  send: {
    icon: Bell,
    label: 'Send',
    iconBg: 'bg-emerald-100',
    iconColor: 'text-emerald-700',
    hasTarget: true,
    hasSource: true,
    getSubtitle: (data) => {
      const { title, body } = (data as SendNodeData).config;
      return { title: title || 'Untitled', body };
    },
  },
  filter: {
    icon: Filter,
    label: 'Filter',
    iconBg: 'bg-pink-100',
    iconColor: 'text-pink-700',
    hasTarget: true,
    hasSource: true,
    getSubtitle: (data) => {
      const { attribute_key, operator, compare_value } = (data as FilterNodeData).config;
      if (!attribute_key) return { title: 'Configure filter...' };
      return { title: `${attribute_key} ${operator} ${JSON.stringify(compare_value)}` };
    },
  },
  exit: {
    icon: LogOut,
    label: 'Exit',
    iconBg: 'bg-rose-100',
    iconColor: 'text-rose-700',
    hasTarget: true,
    hasSource: false,
    getSubtitle: () => ({ title: 'Exit workflow' }),
  },
};

type AnyStepNode = Node<StepNodeData, StepType>;

function StepNode({ id, data, selected }: NodeProps<AnyStepNode>) {
  const { deleteElements } = useReactFlow();
  const variant = variantConfig[data.type];
  const Icon = variant.icon;
  const { title, body } = variant.getSubtitle(data);
  const isBranch = data.type === 'branch';

  return (
    <div className={`group relative ${baseNodeStyles} ${selected ? 'ring-1 ring-gray-400' : ''}`}>
      <Button
        type="button"
        variant="outline"
        size="icon-xs"
        onClick={(e) => {
          e.stopPropagation();
          deleteElements({ nodes: [{ id }] });
        }}
        aria-label="Delete step"
        className="nodrag nopan absolute -top-2 -right-2 rounded-full text-gray-500 hover:text-red-600 hover:border-red-200 opacity-0 scale-75 -translate-y-0.5 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 transition-all duration-75 ease-out"
      >
        <Trash2 />
      </Button>
      {variant.hasTarget && <Handle type="target" position={Position.Left} />}
      <div className="flex items-center gap-2">
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${variant.iconBg}`}>
          <Icon className={`w-4 h-4 ${variant.iconColor}`} />
        </div>
        <div>
          <div className="text-xs text-gray-500 font-medium">{variant.label}</div>
          <div className="text-sm font-semibold text-gray-900 max-w-[180px] truncate">
            {title}
          </div>
          {body && (
            <div className="text-xs text-gray-500 max-w-[180px] truncate">{body}</div>
          )}
        </div>
      </div>
      {variant.hasSource && <Handle type="source" position={Position.Right} />}
      {isBranch && (
        <div className="flex flex-col items-end gap-2 mt-2 text-xs">
          <div className="relative">
            <span className="text-gray-700 font-medium">Yes</span>
            <Handle type="source" position={Position.Right} id="yes" style={{ top: '50%' }} />
          </div>
          <div className="relative">
            <span className="text-gray-700 font-medium">No</span>
            <Handle type="source" position={Position.Right} id="no" style={{ top: '50%' }} />
          </div>
        </div>
      )}
    </div>
  );
}

export const nodeTypes = {
  trigger: StepNode,
  wait: StepNode,
  branch: StepNode,
  send: StepNode,
  filter: StepNode,
  exit: StepNode,
};
