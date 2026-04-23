import { type Edge, type Node, MarkerType } from '@xyflow/react';
import type {
  StepType,
  TriggerEvent,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  StepConfig,
} from './types';
import { getLayoutedElements } from './layout';

export const TRIGGER_EVENTS: TriggerEvent[] = ['contact_added', 'contact_updated', 'event_received'];

export type CanvasNode = Node<StepNodeData, StepType>;

export interface UserColumn {
  id: string;
  name: string;
  dataType: string;
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
        config: { event: 'contact_added' },
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
  }
}

export function getNodeId() {
  return crypto.randomUUID();
}

export interface ApiStep {
  id: string;
  type: 'wait' | 'branch' | 'send';
  config: StepConfig;
}

export interface ApiEdge {
  id: string;
  source: string;
  target: string;
  handle: string | null;
}

export function dbToCanvas(
  workflow: { id: string; name: string; triggerEvent: TriggerEvent },
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
      config: { event: workflow.triggerEvent },
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
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.handle ?? undefined,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
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
