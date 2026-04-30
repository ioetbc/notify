import { type Edge, MarkerType } from '@xyflow/react';
import { match } from 'ts-pattern';

import type { CanvasStep } from '../../../server/services/workflow/workflow.types';
import type { StepNodeData, TriggerType, TriggerEvent, StepConfig } from './types';
import { getLayoutedElements } from './layout';
import type { CanvasNode } from './utils';

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

export interface CanvasToDbPayload {
  name: string;
  trigger_type: TriggerType;
  trigger_event: TriggerEvent;
  steps: CanvasStep[];
  edges: { source: string; target: string; handle: boolean | undefined }[];
}

export function canvasToDb(name: string, nodes: CanvasNode[], edges: Edge[]): CanvasToDbPayload {
  const triggerNode = nodes.find((n) => n.data.type === 'trigger');
  const trigger_type = (triggerNode?.data.type === 'trigger'
    ? triggerNode.data.config.triggerType
    : 'system') as TriggerType;
  const trigger_event = (triggerNode?.data.type === 'trigger'
    ? triggerNode.data.config.event
    : 'user_created') as TriggerEvent;

  const steps = nodes.flatMap((n) =>
    match(n.data)
      .with({ type: 'wait' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
      .with({ type: 'branch' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
      .with({ type: 'send' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
      .with({ type: 'filter' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
      .with({ type: 'exit' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
      .with({ type: 'trigger' }, (): CanvasStep[] => [])
      .exhaustive()
  );

  const triggerNodeIds = new Set(
    nodes.filter((n) => n.data.type === 'trigger').map((n) => n.id)
  );

  const canvasEdges = edges
    .filter((e) => !triggerNodeIds.has(e.source))
    .map((e) => ({
      source: e.source,
      target: e.target,
      handle: e.sourceHandle === 'yes' ? true : e.sourceHandle === 'no' ? false : undefined,
    }));

  return { name, trigger_type, trigger_event, steps, edges: canvasEdges };
}
