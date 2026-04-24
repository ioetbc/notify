import { type Edge, type Node, MarkerType } from '@xyflow/react';
import type {
  StepType,
  TriggerType,
  TriggerEvent,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  FilterNodeData,
  StepConfig,
} from './types';
import { getLayoutedElements } from './layout';

export const SYSTEM_EVENTS = ['user_created', 'user_updated'] as const;
export const TRIGGER_TYPES = ['system', 'custom'] as const;

export type CanvasNode = Node<StepNodeData, StepType>;

export interface UserColumn {
  name: string;
  values: string[];
}

export function formatTriggerEvent(event: string): string {
  return event
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function createNodeData(type: StepType): StepNodeData {
  switch (type) {
    case 'trigger':
      return {
        type: 'trigger',
        config: { triggerType: 'system' as TriggerType, event: 'user_created' },
        label: 'Trigger',
      } as TriggerNodeData;
    case 'wait':
      return {
        type: 'wait',
        config: { hours: 24 },
        label: 'Wait',
      } as WaitNodeData;
    case 'branch':
      return {
        type: 'branch',
        config: { user_column: '', operator: '=', compare_value: '' },
        label: 'Branch',
      } as BranchNodeData;
    case 'send':
      return {
        type: 'send',
        config: { title: 'Notification', body: 'Your message here' },
        label: 'Send',
      } as SendNodeData;
    case 'filter':
      return {
        type: 'filter',
        config: { attribute_key: '', operator: '=', compare_value: '' },
        label: 'Filter',
      } as FilterNodeData;
  }
}

export function getNodeId() {
  return crypto.randomUUID();
}

export interface ApiStep {
  id: string;
  type: 'wait' | 'branch' | 'send' | 'filter';
  config: StepConfig;
}

export interface ApiEdge {
  id: string;
  source: string;
  target: string;
  handle: boolean | null;
}

export function dbToCanvas(
  workflow: { id: string; name: string; triggerType: TriggerType; triggerEvent: TriggerEvent },
  steps: ApiStep[],
  apiEdges: ApiEdge[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: 'trigger',
    type: 'trigger' as const,
    position: { x: 0, y: 0 },
    data: {
      type: 'trigger' as const,
      config: { triggerType: workflow.triggerType, event: workflow.triggerEvent },
      label: 'Trigger',
    },
  });

  for (const s of steps) {
    const label = s.type.charAt(0).toUpperCase() + s.type.slice(1);
    nodes.push({
      id: s.id,
      type: s.type,
      position: { x: 0, y: 0 },
      data: { type: s.type, config: s.config, label } as StepNodeData,
    });
  }

  const stepsWithIncoming = new Set<string>();

  for (const e of apiEdges) {
    const sourceHandle = e.handle === true ? 'yes' : e.handle === false ? 'no' : undefined;
    const label = e.handle === true ? 'Yes' : e.handle === false ? 'No' : undefined;
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      ...(label && { label }),
    });
    stepsWithIncoming.add(e.target);
  }

  // Connect trigger to root step (no incoming edges)
  for (const s of steps) {
    if (!stepsWithIncoming.has(s.id)) {
      edges.push({
        id: `trigger-${s.id}`,
        source: 'trigger',
        target: s.id,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      break;
    }
  }

  return getLayoutedElements(nodes, edges);
}
