import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Edge } from '@xyflow/react';
import { match } from 'ts-pattern';

import { client, queryClient } from '../../lib/api';
import type { CanvasStep } from '../../../server/services/workflow/workflow.types';
import type { TriggerEvent } from './types';
import { dbToCanvas, type CanvasNode, type ApiStep, type ApiEdge, type UserColumn } from './utils';

export function useUserColumns() {
  return useQuery({
    queryKey: ['user-columns'],
    queryFn: async () => {
      const res = await client['user-columns'].$get();
      const data = await res.json();
      return data.columns as UserColumn[];
    },
  });
}

export function useWorkflow(
  workflowId: string | undefined,
  onLoad: (name: string, nodes: CanvasNode[], edges: Edge[]) => void
) {
  return useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      const res = await client.workflows[':id'].$get({ param: { id: workflowId! } });
      if (!res.ok) throw new Error('Failed to load workflow');
      const data = await res.json();
      if ('error' in data) throw new Error(String(data.error));
      const { nodes, edges } = dbToCanvas(
        data.workflow as { id: string; name: string; triggerEvent: TriggerEvent },
        data.steps as ApiStep[],
        (data as { edges: ApiEdge[] }).edges
      );
      onLoad(data.workflow.name, nodes, edges);
      return data;
    },
    enabled: !!workflowId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useSaveWorkflow(
  workflowId: string | undefined,
  workflowName: string,
  nodes: CanvasNode[],
  edges: Edge[]
) {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      const triggerNode = nodes.find((n) => n.data.type === 'trigger');
      const triggerEvent = (triggerNode?.data.type === 'trigger'
        ? triggerNode.data.config.event
        : 'contact_added') as TriggerEvent;

      const stepsPayload = nodes.flatMap((n) =>
        match(n.data)
          .with({ type: 'wait' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
          .with({ type: 'branch' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
          .with({ type: 'send' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
          .with({ type: 'filter' }, (d): CanvasStep[] => [{ id: n.id, type: d.type, config: d.config }])
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
          handle: e.sourceHandle ?? undefined,
        }));

      if (workflowId) {
        const res = await client.workflows[':id'].$put({
          param: { id: workflowId },
          json: {
            name: workflowName,
            trigger_event: triggerEvent,
            steps: stepsPayload,
            edges: canvasEdges,
          },
        });
        if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
        return res.json();
      } else {
        const res = await client.workflows.$post({
          json: {
            name: workflowName,
            trigger_event: triggerEvent,
            steps: stepsPayload,
            edges: canvasEdges,
          },
        });
        if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
        return res.json();
      }
    },
    onSuccess: (data) => {
      if (!workflowId && 'workflow' in data && data.workflow?.id) {
        navigate(`/workflow/${data.workflow.id}`, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
    onError: (err) => {
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });
}
