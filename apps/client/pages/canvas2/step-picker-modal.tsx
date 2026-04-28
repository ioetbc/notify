import { Clock, GitBranch, Bell, Filter, LogOut } from 'lucide-react';
import type { StepKind, ConnectorLocation } from './types';

interface StepPickerModalProps {
  open: boolean;
  location: ConnectorLocation | null;
  onClose: () => void;
  onPick: (kind: StepKind) => void;
  hideExit: boolean;
}

const ALL: { kind: StepKind; label: string; description: string; Icon: typeof Clock }[] = [
  { kind: 'wait', label: 'Wait', description: 'Pause for a duration', Icon: Clock },
  { kind: 'branch', label: 'Branch', description: 'Split into True / False paths', Icon: GitBranch },
  { kind: 'send', label: 'Send', description: 'Send a notification', Icon: Bell },
  { kind: 'filter', label: 'Filter', description: 'Continue only if condition matches', Icon: Filter },
  { kind: 'exit', label: 'Exit', description: 'End the workflow early', Icon: LogOut },
];

export function StepPickerModal({ open, onClose, onPick, hideExit }: StepPickerModalProps) {
  if (!open) return null;

  const options = ALL.filter((o) => !(o.kind === 'exit' && hideExit));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-lg w-[420px] p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-900">Add a step</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2">
          {options.map(({ kind, label, description, Icon }) => (
            <button
              key={kind}
              type="button"
              onClick={() => onPick(kind)}
              className="flex items-center gap-3 px-3 py-2 rounded border border-slate-200 hover:border-blue-400 hover:bg-blue-50 text-left"
            >
              <Icon className="w-4 h-4 text-slate-600" />
              <div>
                <div className="text-sm font-medium text-slate-900">{label}</div>
                <div className="text-xs text-slate-500">{description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
