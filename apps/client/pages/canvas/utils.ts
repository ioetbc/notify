import { type Edge, type Node, MarkerType } from '@xyflow/react';
import { match } from 'ts-pattern';
import type {
  StepType,
  TriggerType,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
  FilterNodeData,
  ExitNodeData,
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
