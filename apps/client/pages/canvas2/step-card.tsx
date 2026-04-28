import { match } from 'ts-pattern';
import { Clock, Bell, Filter, LogOut, Trash2, GitBranch } from 'lucide-react';
import type { TreeNode } from './types';

interface StepCardProps {
  node: Exclude<TreeNode, { kind: 'branch' }> | { id: string; kind: 'branch'; label: string };
  selected: boolean;
  canDelete: boolean;
  onClick: () => void;
  onDelete: () => void;
}

interface Style {
  bg: string;
  border: string;
  ring: string;
  iconColor: string;
  labelColor: string;
  Icon: typeof Clock;
}

const styles: Record<TreeNode['kind'], Style> = {
  wait: { bg: 'bg-amber-50', border: 'border-amber-300', ring: 'ring-amber-500', iconColor: 'text-amber-600', labelColor: 'text-amber-800', Icon: Clock },
  send: { bg: 'bg-blue-50', border: 'border-blue-300', ring: 'ring-blue-500', iconColor: 'text-blue-600', labelColor: 'text-blue-800', Icon: Bell },
  filter: { bg: 'bg-orange-50', border: 'border-orange-300', ring: 'ring-orange-500', iconColor: 'text-orange-600', labelColor: 'text-orange-800', Icon: Filter },
  exit: { bg: 'bg-red-50', border: 'border-red-300', ring: 'ring-red-500', iconColor: 'text-red-600', labelColor: 'text-red-800', Icon: LogOut },
  branch: { bg: 'bg-purple-50', border: 'border-purple-300', ring: 'ring-purple-500', iconColor: 'text-purple-600', labelColor: 'text-purple-800', Icon: GitBranch },
};

function summary(node: StepCardProps['node']): string {
  return match(node)
    .with({ kind: 'wait' }, (n) => {
      const h = n.config.hours;
      return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
    })
    .with({ kind: 'send' }, (n) => n.config.title || 'Untitled')
    .with({ kind: 'filter' }, (n) =>
      n.config.attribute_key
        ? `${n.config.attribute_key} ${n.config.operator} ${JSON.stringify(n.config.compare_value)}`
        : 'Configure filter…'
    )
    .with({ kind: 'exit' }, () => 'Exit workflow')
    .with({ kind: 'branch' }, (n) => n.label)
    .exhaustive();
}

export function StepCard({ node, selected, canDelete, onClick, onDelete }: StepCardProps) {
  const style = styles[node.kind];
  const { Icon } = style;
  const title = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);

  return (
    <div
      onClick={onClick}
      className={`group relative px-4 py-3 rounded-lg border-2 shadow-sm w-[260px] mx-auto cursor-pointer ${style.bg} ${style.border} ${selected ? `ring-2 ${style.ring}` : ''}`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${style.iconColor}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${style.iconColor}`}>{title}</div>
          <div className={`text-sm font-semibold truncate ${style.labelColor}`}>{summary(node)}</div>
        </div>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 p-1 rounded text-slate-400 hover:text-red-600 hover:bg-white opacity-0 group-hover:opacity-100 transition"
          aria-label="Delete step"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
