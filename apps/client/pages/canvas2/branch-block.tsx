import { GitBranch, Trash2 } from 'lucide-react';
import type { BranchNode } from './types';
import type { ChainPath, ConnectorLocation } from './types';
import { Chain } from './chain';

interface BranchBlockProps {
  node: BranchNode;
  chainPath: ChainPath;
  indexInChain: number;
  selectedStepId: string | null;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (loc: ConnectorLocation) => void;
  onInsert: (loc: ConnectorLocation) => void;
}

function endsInExit(chain: { kind: string }[]): boolean {
  return chain[chain.length - 1]?.kind === 'exit';
}

export function BranchBlock({
  node,
  chainPath,
  indexInChain,
  selectedStepId,
  canDelete,
  onSelect,
  onDelete,
  onInsert,
}: BranchBlockProps) {
  const yesEndsInExit = endsInExit(node.yes);
  const noEndsInExit = endsInExit(node.no);
  const showMerger = !yesEndsInExit || !noEndsInExit;

  const summary = node.config.user_column
    ? `${node.config.user_column} ${node.config.operator}${
        node.config.operator === '=' || node.config.operator === '!='
          ? ` "${node.config.compare_value ?? ''}"`
          : ''
      }`
    : 'Configure condition…';

  return (
    <div className="flex flex-col items-stretch">
      {/* Branch card */}
      <div
        onClick={() => onSelect(node.id)}
        className={`group relative px-4 py-3 rounded-lg border-2 shadow-sm w-[260px] mx-auto cursor-pointer bg-purple-50 border-purple-300 ${selectedStepId === node.id ? 'ring-2 ring-purple-500' : ''}`}
      >
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-purple-600" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium text-purple-600">Branch</div>
            <div className="text-sm font-semibold text-purple-800 truncate">{summary}</div>
          </div>
        </div>
        {canDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete({ chainPath, index: indexInChain });
            }}
            className="absolute top-1 right-1 p-1 rounded text-slate-400 hover:text-red-600 hover:bg-white opacity-0 group-hover:opacity-100 transition"
            aria-label="Delete branch"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Fan-out SVG */}
      <svg viewBox="0 0 200 24" preserveAspectRatio="none" className="w-full h-6 mt-1">
        <line x1="100" y1="0" x2="40" y2="24" stroke="#cbd5e1" strokeWidth="1" />
        <line x1="100" y1="0" x2="160" y2="24" stroke="#cbd5e1" strokeWidth="1" />
      </svg>

      {/* Two columns */}
      <div className="grid grid-cols-2 gap-12">
        <div>
          <div className="text-center text-xs font-medium text-green-700 mb-1">True</div>
          <Chain
            chain={node.yes}
            chainPath={[...chainPath, { branchId: node.id, side: 'yes' }]}
            selectedStepId={selectedStepId}
            onSelect={onSelect}
            onDelete={onDelete}
            onInsert={onInsert}
            isSubChain
          />
        </div>
        <div>
          <div className="text-center text-xs font-medium text-red-700 mb-1">False</div>
          <Chain
            chain={node.no}
            chainPath={[...chainPath, { branchId: node.id, side: 'no' }]}
            selectedStepId={selectedStepId}
            onSelect={onSelect}
            onDelete={onDelete}
            onInsert={onInsert}
            isSubChain
          />
        </div>
      </div>

      {/* Fan-in (merger) SVG */}
      {showMerger && (
        <svg viewBox="0 0 200 24" preserveAspectRatio="none" className="w-full h-6">
          {!yesEndsInExit && (
            <line x1="40" y1="0" x2="100" y2="24" stroke="#cbd5e1" strokeWidth="1" />
          )}
          {!noEndsInExit && (
            <line x1="160" y1="0" x2="100" y2="24" stroke="#cbd5e1" strokeWidth="1" />
          )}
        </svg>
      )}
    </div>
  );
}
