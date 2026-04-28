import type { TreeNode, ChainPath, ConnectorLocation } from './types';
import { StepCard } from './step-card';
import { BranchBlock } from './branch-block';

interface TreeNodeViewProps {
  node: TreeNode;
  chainPath: ChainPath;
  indexInChain: number;
  selectedStepId: string | null;
  canDelete: boolean;
  onSelect: (id: string) => void;
  onDelete: (loc: ConnectorLocation) => void;
  onInsert: (loc: ConnectorLocation) => void;
}

export function TreeNodeView({
  node,
  chainPath,
  indexInChain,
  selectedStepId,
  canDelete,
  onSelect,
  onDelete,
  onInsert,
}: TreeNodeViewProps) {
  if (node.kind === 'branch') {
    return (
      <BranchBlock
        node={node}
        chainPath={chainPath}
        indexInChain={indexInChain}
        selectedStepId={selectedStepId}
        canDelete={canDelete}
        onSelect={onSelect}
        onDelete={onDelete}
        onInsert={onInsert}
      />
    );
  }

  return (
    <StepCard
      node={node}
      selected={selectedStepId === node.id}
      canDelete={canDelete}
      onClick={() => onSelect(node.id)}
      onDelete={() => onDelete({ chainPath, index: indexInChain })}
    />
  );
}
