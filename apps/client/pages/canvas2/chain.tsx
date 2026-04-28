import type { TreeNode, ChainPath, ConnectorLocation } from './types';
import { Connector } from './connector';
import { TreeNodeView } from './tree-node';

interface ChainProps {
  chain: TreeNode[];
  chainPath: ChainPath;
  selectedStepId: string | null;
  onSelect: (id: string) => void;
  onDelete: (loc: ConnectorLocation) => void;
  onInsert: (loc: ConnectorLocation) => void;
  isSubChain?: boolean;
}

export function Chain({
  chain,
  chainPath,
  selectedStepId,
  onSelect,
  onDelete,
  onInsert,
  isSubChain = false,
}: ChainProps) {
  const lastIsExit = chain[chain.length - 1]?.kind === 'exit';

  return (
    <div className="flex flex-col items-stretch">
      {chain.map((node, i) => {
        const isOnlyExitInRoot =
          !isSubChain &&
          node.kind === 'exit' &&
          chain.filter((n) => n.kind === 'exit').length === 1 &&
          chain[chain.length - 1].id === node.id;

        const canDelete = !isOnlyExitInRoot;

        return (
          <div key={node.id}>
            <Connector location={{ chainPath, index: i }} onInsert={onInsert} />
            <TreeNodeView
              node={node}
              chainPath={chainPath}
              indexInChain={i}
              selectedStepId={selectedStepId}
              canDelete={canDelete}
              onSelect={onSelect}
              onDelete={onDelete}
              onInsert={onInsert}
            />
          </div>
        );
      })}
      {/* Trailing connector only if chain doesn't end in exit (sub-chain that rejoins) */}
      {!lastIsExit && (
        <Connector
          location={{ chainPath, index: chain.length }}
          onInsert={onInsert}
        />
      )}
    </div>
  );
}
