import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { client, queryClient } from '../../lib/api';
import type { WorkflowTree, TriggerType } from './types';
import type { ApiStep, ApiEdge } from './api-types';
import { flatToTree } from './deserialize';
import { treeToFlat } from './serialize';
import { validateTree } from './validation';

export interface UserColumn {
  name: string;
  values: string[];
}

export function useUserColumns2() {
  return useQuery({
    queryKey: ['user-columns'],
    queryFn: async () => {
      const res = await client['user-columns'].$get();
      const data = await res.json();
      return data.columns as UserColumn[];
    },
  });
}

export function useEventNames2() {
  return useQuery({
    queryKey: ['event-names'],
    queryFn: async () => {
      const res = await client['event-names'].$get();
      const data = await res.json();
      return data.event_names as string[];
    },
  });
}

export function useWorkflow2(
  workflowId: string | undefined,
  onLoad: (tree: WorkflowTree) => void
) {
  return useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      const res = await client.workflows[':id'].$get({ param: { id: workflowId! } });
      if (!res.ok) throw new Error('Failed to load workflow');
      const data = await res.json();
      if ('error' in data) throw new Error(String(data.error));
      const wf = data.workflow as {
        id: string;
        name: string;
        triggerType: TriggerType;
        triggerEvent: string;
        status: string;
      };
      const tree = flatToTree(
        wf,
        data.steps as ApiStep[],
        (data as { edges: ApiEdge[] }).edges
      );
      onLoad(tree);
      return data;
    },
    enabled: !!workflowId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function usePublish2(workflowId: string | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!workflowId) throw new Error('Cannot publish unsaved workflow');
      const res = await client.workflows[':id'].publish.$patch({
        param: { id: workflowId },
      });
      if (!res.ok) throw new Error(`Publish failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
    onError: (err) => {
      alert(`Failed to publish: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });
}

export function useSave2(workflowId: string | undefined, tree: WorkflowTree) {
  const navigate = useNavigate();

  return useMutation({
    mutationFn: async () => {
      const errors = validateTree(tree);
      if (errors.length > 0) {
        throw new Error(errors.join('\n'));
      }

      const { steps, edges } = treeToFlat(tree);

      const triggerType = tree.trigger.triggerType;
      const triggerEvent = tree.trigger.event;

      const payload = {
        name: tree.name,
        trigger_type: triggerType,
        trigger_event: triggerEvent,
        steps,
        edges,
      };

      if (workflowId) {
        const res = await client.workflows[':id'].$put({
          param: { id: workflowId },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          json: payload as any,
        });
        if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
        return res.json();
      } else {
        const res = await client.workflows.$post({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          json: payload as any,
        });
        if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
        return res.json();
      }
    },
    onSuccess: (data) => {
      if (!workflowId && 'workflow' in data && data.workflow?.id) {
        navigate(`/canvas2/${data.workflow.id}`, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
    onError: (err) => {
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });
}
