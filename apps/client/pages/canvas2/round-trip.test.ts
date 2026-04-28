import { describe, expect, test } from 'bun:test';
import { treeToFlat } from './serialize';
import { flatToTree } from './deserialize';
import type { WorkflowTree } from './types';
import type { ApiStep, ApiEdge } from './api-types';

function roundtrip(tree: WorkflowTree): WorkflowTree {
  const { steps, edges } = treeToFlat(tree);
  const apiSteps: ApiStep[] = steps.map((s) => ({ ...s }));
  const apiEdges: ApiEdge[] = edges.map((e, i) => ({
    id: `e${i}`,
    source: e.source,
    target: e.target,
    handle: e.handle ?? null,
  }));
  return flatToTree(
    {
      name: tree.name,
      triggerType: tree.trigger.triggerType,
      triggerEvent: tree.trigger.event,
      status: tree.status ?? 'draft',
    },
    apiSteps,
    apiEdges
  );
}

const baseMeta = {
  name: 'wf',
  trigger: { triggerType: 'system' as const, event: 'user_created' },
  status: 'draft' as const,
};

describe('canvas2 round-trip', () => {
  test('linear: trigger → wait → send → exit', () => {
    const tree: WorkflowTree = {
      ...baseMeta,
      root: [
        { id: 'w', kind: 'wait', config: { hours: 2 } },
        { id: 's', kind: 'send', config: { title: 'hi', body: 'there' } },
        { id: 'e', kind: 'exit', config: {} },
      ],
    };
    expect(roundtrip(tree)).toEqual(tree);
  });

  test('branch with both sides rejoining', () => {
    const tree: WorkflowTree = {
      ...baseMeta,
      root: [
        {
          id: 'b',
          kind: 'branch',
          config: { user_column: 'plan', operator: '=', compare_value: 'pro' },
          yes: [{ id: 'fy', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 1 } }],
          no: [{ id: 'fn', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 2 } }],
        },
        { id: 's', kind: 'send', config: { title: 't', body: 'b' } },
        { id: 'e', kind: 'exit', config: {} },
      ],
    };
    expect(roundtrip(tree)).toEqual(tree);
  });

  test('branch with one side ending in exit', () => {
    const tree: WorkflowTree = {
      ...baseMeta,
      root: [
        {
          id: 'b',
          kind: 'branch',
          config: { user_column: 'plan', operator: '=', compare_value: 'pro' },
          yes: [
            { id: 'fy', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 1 } },
            { id: 'ex1', kind: 'exit', config: {} },
          ],
          no: [{ id: 'fn', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 2 } }],
        },
        { id: 's', kind: 'send', config: { title: 't', body: 'b' } },
        { id: 'rex', kind: 'exit', config: {} },
      ],
    };
    expect(roundtrip(tree)).toEqual(tree);
  });

  test('nested branch on the True path', () => {
    const tree: WorkflowTree = {
      ...baseMeta,
      root: [
        {
          id: 'b',
          kind: 'branch',
          config: { user_column: 'plan', operator: '=', compare_value: 'pro' },
          yes: [
            {
              id: 'b2',
              kind: 'branch',
              config: { user_column: 'tier', operator: '=', compare_value: 'gold' },
              yes: [{ id: 'fyy', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 1 } }],
              no: [{ id: 'fyn', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 2 } }],
            },
          ],
          no: [{ id: 'fn', kind: 'filter', config: { attribute_key: 'a', operator: '=', compare_value: 3 } }],
        },
        { id: 's', kind: 'send', config: { title: 't', body: 'b' } },
        { id: 'rex', kind: 'exit', config: {} },
      ],
    };
    expect(roundtrip(tree)).toEqual(tree);
  });
});
