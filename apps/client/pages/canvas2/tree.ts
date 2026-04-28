import { match } from 'ts-pattern';
import type {
  TreeNode,
  BranchNode,
  WorkflowTree,
  ChainPath,
  ConnectorLocation,
  StepKind,
  WaitConfig,
  BranchConfig,
  SendConfig,
  FilterConfig,
  ExitConfig,
} from './types';

export function newId(): string {
  return crypto.randomUUID();
}

export function defaultConfigFor(
  kind: StepKind
): WaitConfig | BranchConfig | SendConfig | FilterConfig | ExitConfig {
  return match(kind)
    .with('wait', (): WaitConfig => ({ hours: 24 }))
    .with(
      'branch',
      (): BranchConfig => ({ user_column: '', operator: '=', compare_value: '' })
    )
    .with('send', (): SendConfig => ({ title: 'Notification', body: 'Your message here' }))
    .with(
      'filter',
      (): FilterConfig => ({ attribute_key: '', operator: '=', compare_value: '' })
    )
    .with('exit', (): ExitConfig => ({}))
    .exhaustive();
}

export function newNodeForKind(kind: StepKind): TreeNode {
  return match(kind)
    .with('wait', (): TreeNode => ({ id: newId(), kind: 'wait', config: defaultConfigFor('wait') as WaitConfig }))
    .with('send', (): TreeNode => ({ id: newId(), kind: 'send', config: defaultConfigFor('send') as SendConfig }))
    .with(
      'filter',
      (): TreeNode => ({ id: newId(), kind: 'filter', config: defaultConfigFor('filter') as FilterConfig })
    )
    .with('exit', (): TreeNode => ({ id: newId(), kind: 'exit', config: defaultConfigFor('exit') as ExitConfig }))
    .with(
      'branch',
      (): TreeNode => ({
        id: newId(),
        kind: 'branch',
        config: defaultConfigFor('branch') as BranchConfig,
        yes: [],
        no: [],
      })
    )
    .exhaustive();
}

export function seedTree(): WorkflowTree {
  return {
    name: 'Untitled Workflow',
    trigger: { triggerType: 'system', event: 'user_created' },
    root: [{ id: newId(), kind: 'exit', config: {} }],
    status: 'draft',
  };
}

export function getChainAtPath(tree: WorkflowTree, chainPath: ChainPath): TreeNode[] {
  let chain: TreeNode[] = tree.root;
  for (const segment of chainPath) {
    const branch = chain.find(
      (n): n is BranchNode => n.kind === 'branch' && n.id === segment.branchId
    );
    if (!branch) throw new Error(`Branch ${segment.branchId} not found in chain`);
    chain = segment.side === 'yes' ? branch.yes : branch.no;
  }
  return chain;
}

function setChainAtPath(
  tree: WorkflowTree,
  chainPath: ChainPath,
  newChain: TreeNode[]
): WorkflowTree {
  if (chainPath.length === 0) {
    return { ...tree, root: newChain };
  }

  function rebuild(chain: TreeNode[], depth: number): TreeNode[] {
    const segment = chainPath[depth];
    return chain.map((n) => {
      if (n.kind !== 'branch' || n.id !== segment.branchId) return n;
      const isLast = depth === chainPath.length - 1;
      const subChain = segment.side === 'yes' ? n.yes : n.no;
      const updatedSub = isLast ? newChain : rebuild(subChain, depth + 1);
      return segment.side === 'yes'
        ? { ...n, yes: updatedSub }
        : { ...n, no: updatedSub };
    });
  }

  return { ...tree, root: rebuild(tree.root, 0) };
}

export function findNodeById(tree: WorkflowTree, id: string): TreeNode | null {
  function search(chain: TreeNode[]): TreeNode | null {
    for (const n of chain) {
      if (n.id === id) return n;
      if (n.kind === 'branch') {
        const inYes = search(n.yes);
        if (inYes) return inYes;
        const inNo = search(n.no);
        if (inNo) return inNo;
      }
    }
    return null;
  }
  return search(tree.root);
}

export function findPathById(
  tree: WorkflowTree,
  id: string
): { chainPath: ChainPath; index: number } | null {
  function search(chain: TreeNode[], chainPath: ChainPath): { chainPath: ChainPath; index: number } | null {
    for (let i = 0; i < chain.length; i++) {
      const n = chain[i];
      if (n.id === id) return { chainPath, index: i };
      if (n.kind === 'branch') {
        const inYes = search(n.yes, [...chainPath, { branchId: n.id, side: 'yes' }]);
        if (inYes) return inYes;
        const inNo = search(n.no, [...chainPath, { branchId: n.id, side: 'no' }]);
        if (inNo) return inNo;
      }
    }
    return null;
  }
  return search(tree.root, []);
}

export function updateNodeAtPath(
  tree: WorkflowTree,
  id: string,
  update: (node: TreeNode) => TreeNode
): WorkflowTree {
  function walk(chain: TreeNode[]): TreeNode[] {
    return chain.map((n) => {
      if (n.id === id) return update(n);
      if (n.kind === 'branch') {
        return { ...n, yes: walk(n.yes), no: walk(n.no) };
      }
      return n;
    });
  }
  return { ...tree, root: walk(tree.root) };
}

export function insertNodeAtPath(
  tree: WorkflowTree,
  loc: ConnectorLocation,
  node: TreeNode
): WorkflowTree {
  const chain = getChainAtPath(tree, loc.chainPath);
  const next = [...chain.slice(0, loc.index), node, ...chain.slice(loc.index)];
  return setChainAtPath(tree, loc.chainPath, next);
}

export function removeNodeAtPath(
  tree: WorkflowTree,
  loc: { chainPath: ChainPath; index: number }
): WorkflowTree {
  const chain = getChainAtPath(tree, loc.chainPath);
  const next = [...chain.slice(0, loc.index), ...chain.slice(loc.index + 1)];
  return setChainAtPath(tree, loc.chainPath, next);
}

export function chainHasDownstreamExit(tree: WorkflowTree, loc: ConnectorLocation): boolean {
  const chain = getChainAtPath(tree, loc.chainPath);
  for (let i = loc.index; i < chain.length; i++) {
    if (chain[i].kind === 'exit') return true;
  }
  return false;
}

export function isOnlyExitInRootChain(tree: WorkflowTree, id: string): boolean {
  const path = findPathById(tree, id);
  if (!path) return false;
  if (path.chainPath.length !== 0) return false;
  const node = tree.root[path.index];
  if (node.kind !== 'exit') return false;
  return tree.root.filter((n) => n.kind === 'exit').length === 1;
}
