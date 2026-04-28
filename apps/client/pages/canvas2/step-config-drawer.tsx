import { match } from 'ts-pattern';
import type { TreeNode, WaitConfig, BranchConfig, SendConfig, FilterConfig } from './types';
import type { UserColumn } from './hooks';
import {
  WaitConfigForm,
  BranchConfigForm,
  SendConfigForm,
  FilterConfigForm,
} from './config-forms';

interface StepConfigDrawerProps {
  node: TreeNode | null;
  userColumns: UserColumn[];
  onClose: () => void;
  onUpdate: (id: string, config: TreeNode['config']) => void;
}

export function StepConfigDrawer({ node, userColumns, onClose, onUpdate }: StepConfigDrawerProps) {
  if (!node) return null;

  const title = node.kind.charAt(0).toUpperCase() + node.kind.slice(1);

  return (
    <div className="fixed top-0 right-0 h-full w-80 bg-white border-l border-slate-200 shadow-lg p-4 z-40 overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900">{title} Step</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {match(node)
        .with({ kind: 'wait' }, (n) => (
          <WaitConfigForm
            config={n.config}
            onUpdate={(c: WaitConfig) => onUpdate(n.id, c)}
          />
        ))
        .with({ kind: 'branch' }, (n) => (
          <BranchConfigForm
            config={n.config}
            userColumns={userColumns}
            onUpdate={(c: BranchConfig) => onUpdate(n.id, c)}
          />
        ))
        .with({ kind: 'send' }, (n) => (
          <SendConfigForm
            config={n.config}
            onUpdate={(c: SendConfig) => onUpdate(n.id, c)}
          />
        ))
        .with({ kind: 'filter' }, (n) => (
          <FilterConfigForm
            config={n.config}
            userColumns={userColumns}
            onUpdate={(c: FilterConfig) => onUpdate(n.id, c)}
          />
        ))
        .with({ kind: 'exit' }, () => (
          <p className="text-sm text-slate-500">
            This step ends the workflow early. The enrollment will be marked as exited.
          </p>
        ))
        .exhaustive()}
    </div>
  );
}
