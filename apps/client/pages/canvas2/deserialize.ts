import { match, P } from 'ts-pattern';
import type { TreeNode, WorkflowTree, TriggerType } from './types';
import type { ApiStep, ApiEdge } from './api-types';

export function flatToTree(
  workflow: { name: string; triggerType: TriggerType; triggerEvent: string; status: string },
  steps: ApiStep[],
  apiEdges: ApiEdge[]
): WorkflowTree {
  const byId = new Map<string, ApiStep>();
  for (const s of steps) byId.set(s.id, s);

  const outgoing = new Map<string, ApiEdge[]>();
  const incoming = new Map<string, ApiEdge[]>();
  for (const e of apiEdges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e);
  }

  let rootStepId: string | null = null;
  for (const s of steps) {
    if (!incoming.has(s.id)) {
      rootStepId = s.id;
      break;
    }
  }

  function walkLinear(start: string | null | undefined, outerStop: string | null): string[] {
    const visited: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = start ?? null;
    while (cur) {
      if (seen.has(cur)) break;
      seen.add(cur);
      visited.push(cur);
      if (cur === outerStop) break;
      const step = byId.get(cur);
      if (!step) break;
      if (step.type === 'exit') break;
      const outs = outgoing.get(cur) ?? [];
      if (step.type === 'branch') {
        const yesEdge = outs.find((e) => e.handle === true);
        const noEdge = outs.find((e) => e.handle === false);
        const markerEdge = outs.find((e) => e.handle === null || e.handle === undefined);
        const inner = markerEdge?.target ?? findRejoin(yesEdge?.target, noEdge?.target, outerStop);
        cur = inner ?? null;
      } else {
        cur = outs[0]?.target ?? null;
      }
    }
    return visited;
  }

  function findRejoin(
    yesStart: string | null | undefined,
    noStart: string | null | undefined,
    outerStop: string | null
  ): string | null {
    if (!yesStart || !noStart) return null;
    const yesPath = walkLinear(yesStart, outerStop);
    const noPath = walkLinear(noStart, outerStop);
    const noSet = new Set(noPath);
    for (const id of yesPath) {
      if (noSet.has(id)) {
        const step = byId.get(id);
        if (step?.type !== 'exit') return id;
      }
    }
    return null;
  }

  function walkChain(startId: string | null, stopAtId: string | null): TreeNode[] {
    const chain: TreeNode[] = [];
    const seen = new Set<string>();
    let cur: string | null = startId;
    while (cur && cur !== stopAtId) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const step = byId.get(cur);
      if (!step) break;
      const outs = outgoing.get(cur) ?? [];

      if (step.type === 'branch') {
        const yesEdge = outs.find((e) => e.handle === true);
        const noEdge = outs.find((e) => e.handle === false);
        const markerEdge = outs.find((e) => e.handle === null || e.handle === undefined);
        const rejoin =
          markerEdge?.target ?? findRejoin(yesEdge?.target, noEdge?.target, stopAtId);
        const branchNode: TreeNode = {
          id: step.id,
          kind: 'branch',
          config: step.config as Extract<TreeNode, { kind: 'branch' }>['config'],
          yes: walkChain(yesEdge?.target ?? null, rejoin ?? stopAtId),
          no: walkChain(noEdge?.target ?? null, rejoin ?? stopAtId),
        };
        chain.push(branchNode);
        cur = rejoin ?? null;
      } else {
        const leaf: TreeNode = match(step.type as 'wait' | 'send' | 'filter' | 'exit' | 'branch')
          .with(P.union('wait'), (): TreeNode => ({ id: step.id, kind: 'wait', config: step.config as Extract<TreeNode, { kind: 'wait' }>['config'] }))
          .with(P.union('send'), (): TreeNode => ({ id: step.id, kind: 'send', config: step.config as Extract<TreeNode, { kind: 'send' }>['config'] }))
          .with(P.union('filter'), (): TreeNode => ({ id: step.id, kind: 'filter', config: step.config as Extract<TreeNode, { kind: 'filter' }>['config'] }))
          .with(P.union('exit'), (): TreeNode => ({ id: step.id, kind: 'exit', config: step.config as Extract<TreeNode, { kind: 'exit' }>['config'] }))
          .with(P.union('branch'), (): TreeNode => { throw new Error('unreachable'); })
          .exhaustive();
        chain.push(leaf);
        if (step.type === 'exit') {
          cur = null;
        } else {
          cur = outs[0]?.target ?? null;
        }
      }
    }
    return chain;
  }

  const root = walkChain(rootStepId, null);

  return {
    name: workflow.name,
    trigger: { triggerType: workflow.triggerType, event: workflow.triggerEvent },
    root,
    status: workflow.status as WorkflowTree['status'],
  };
}
