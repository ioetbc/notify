import { type Edge, type Node, MarkerType } from '@xyflow/react';
import { match } from 'ts-pattern';
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
  ExitNodeData,
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
  return match(type)
    .returnType<StepNodeData>()
    .with('trigger', () => ({
      type: 'trigger',
      config: { triggerType: 'system' as TriggerType, event: 'user_created' },
      label: 'Trigger',
    } as TriggerNodeData))
    .with('wait', () => ({
      type: 'wait',
      config: { hours: 24 },
      label: 'Wait',
    } as WaitNodeData))
    .with('branch', () => ({
      type: 'branch',
      config: { user_column: '', operator: '=', compare_value: '' },
      label: 'Branch',
    } as BranchNodeData))
    .with('send', () => ({
      type: 'send',
      config: { title: 'Notification', body: 'Your message here' },
      label: 'Send',
    } as SendNodeData))
    .with('filter', () => ({
      type: 'filter',
      config: { attribute_key: '', operator: '=', compare_value: '' },
      label: 'Filter',
    } as FilterNodeData))
    .with('exit', () => ({
      type: 'exit',
      config: {},
      label: 'Exit',
    } as ExitNodeData))
    .exhaustive();
}

export function getNodeId() {
  return crypto.randomUUID();
}

export function createInitialWorkflow(): { nodes: CanvasNode[]; edges: Edge[] } {
  const triggerId = getNodeId();
  const waitId = getNodeId();
  const sendId = getNodeId();

  const nodes: CanvasNode[] = [
    { id: triggerId, type: 'trigger', position: { x: 0, y: 0 }, data: createNodeData('trigger') },
    { id: waitId, type: 'wait', position: { x: 0, y: 0 }, data: createNodeData('wait') },
    { id: sendId, type: 'send', position: { x: 0, y: 0 }, data: createNodeData('send') },
  ];

  const edges: Edge[] = [
    {
      id: `${triggerId}-${waitId}`,
      source: triggerId,
      target: waitId,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
    },
    {
      id: `${waitId}-${sendId}`,
      source: waitId,
      target: sendId,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
    },
  ];

  return getLayoutedElements(nodes, edges);
}

export interface ApiStep {
  id: string;
  type: 'wait' | 'branch' | 'send' | 'filter' | 'exit';
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
