import { match } from 'ts-pattern';
import type { TreeNode, WorkflowTree } from './types';
import type { CanvasStep, CanvasEdge } from '../../../server/services/workflow/workflow.types';

export interface FlatWorkflow {
  steps: CanvasStep[];
  edges: CanvasEdge[];
}

function endsInExit(chain: TreeNode[]): boolean {
  const last = chain[chain.length - 1];
  return last?.kind === 'exit';
}

export function treeToFlat(tree: WorkflowTree): FlatWorkflow {
  const steps: CanvasStep[] = [];
  const edges: CanvasEdge[] = [];

  function serialize(chain: TreeNode[], fallback: string | null): string | null {
    for (let i = 0; i < chain.length; i++) {
      const node = chain[i];
      const successor = chain[i + 1]?.id ?? fallback;

      match(node)
        .with({ kind: 'wait' }, (n) => {
          steps.push({ id: n.id, type: 'wait', config: n.config });
          if (successor) edges.push({ source: n.id, target: successor });
        })
        .with({ kind: 'send' }, (n) => {
          steps.push({ id: n.id, type: 'send', config: n.config });
          if (successor) edges.push({ source: n.id, target: successor });
        })
        .with({ kind: 'filter' }, (n) => {
          steps.push({ id: n.id, type: 'filter', config: n.config });
          if (successor) edges.push({ source: n.id, target: successor });
        })
        .with({ kind: 'exit' }, (n) => {
          steps.push({ id: n.id, type: 'exit', config: n.config });
        })
        .with({ kind: 'branch' }, (n) => {
          steps.push({ id: n.id, type: 'branch', config: n.config });
          const yesEntry = serialize(n.yes, successor);
          const noEntry = serialize(n.no, successor);
          if (yesEntry) edges.push({ source: n.id, target: yesEntry, handle: true });
          if (noEntry) edges.push({ source: n.id, target: noEntry, handle: false });
          const yesRejoins = !endsInExit(n.yes);
          const noRejoins = !endsInExit(n.no);
          if (successor && (yesRejoins || noRejoins)) {
            edges.push({ source: n.id, target: successor });
          }
        })
        .exhaustive();
    }

    return chain[0]?.id ?? fallback;
  }

  serialize(tree.root, null);

  return { steps, edges };
}
