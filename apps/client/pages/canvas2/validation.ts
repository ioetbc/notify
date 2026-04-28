import type { TreeNode, WorkflowTree } from './types';

export function validateTree(tree: WorkflowTree): string[] {
  const errors: string[] = [];

  if (!tree.trigger.event.trim()) {
    errors.push('Trigger event is required.');
  }

  if (tree.root.length === 0) {
    errors.push('Workflow has no steps.');
  } else if (!everyTerminalEndsInExit(tree.root)) {
    errors.push('Every path must end in an Exit step.');
  }

  const dupes = duplicateIds(tree.root);
  if (dupes.length > 0) {
    errors.push(`Duplicate step ids: ${dupes.join(', ')}`);
  }

  return errors;
}

function everyTerminalEndsInExit(chain: TreeNode[]): boolean {
  if (chain.length === 0) return false;
  const last = chain[chain.length - 1];
  if (last.kind === 'exit') return true;
  if (last.kind === 'branch') {
    return everyTerminalEndsInExit(last.yes) && everyTerminalEndsInExit(last.no);
  }
  return false;
}

function duplicateIds(chain: TreeNode[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  function walk(c: TreeNode[]) {
    for (const n of c) {
      if (seen.has(n.id)) dupes.add(n.id);
      seen.add(n.id);
      if (n.kind === 'branch') {
        walk(n.yes);
        walk(n.no);
      }
    }
  }
  walk(chain);
  return [...dupes];
}
