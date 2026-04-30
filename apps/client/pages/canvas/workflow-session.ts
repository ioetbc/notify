import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Edge } from '@xyflow/react';

import { client, queryClient } from '../../lib/api';
import type { TriggerEvent, TriggerType } from './types';
import { type CanvasNode, createInitialWorkflow } from './utils';
import { dbToCanvas, canvasToDb, type ApiStep, type ApiEdge } from './codec';

export type WorkflowStatus = 'draft' | 'active';
export type MutationState = 'idle' | 'pending' | 'error';

export type SaveResult = { id: string } | { error: string };
export type PublishResult = { ok: true } | { error: string };

export interface WorkflowSession {
  name: string;
  setName: (name: string) => void;
  nodes: CanvasNode[];
  edges: Edge[];
  status: WorkflowStatus;
  isLoading: boolean;
  isReady: boolean;
  save: () => Promise<SaveResult>;
  publish: () => Promise<PublishResult>;
  saveState: MutationState;
  publishState: MutationState;
  lastError: string | null;
  applyEdit: (next: { nodes?: CanvasNode[]; edges?: Edge[] }) => void;
}

function mutationState(isPending: boolean, isError: boolean): MutationState {
  if (isPending) return 'pending';
  if (isError) return 'error';
  return 'idle';
}

export function useWorkflowSession(workflowId: string | undefined): WorkflowSession {
  const navigate = useNavigate();
  const initial = workflowId ? { nodes: [], edges: [] } : createInitialWorkflow();

  const [name, setName] = useState('Untitled Workflow');
  const [nodes, setNodes] = useState<CanvasNode[]>(initial.nodes);
  const [edges, setEdges] = useState<Edge[]>(initial.edges);
  const [status, setStatus] = useState<WorkflowStatus>('draft');
  const [lastError, setLastError] = useState<string | null>(null);

  const stateRef = useRef({ name, nodes, edges });
  useEffect(() => {
    stateRef.current = { name, nodes, edges };
  }, [name, nodes, edges]);

  const query = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      const res = await client.workflows[':id'].$get({ param: { id: workflowId! } });
      if (!res.ok) throw new Error('Failed to load workflow');
      const data = await res.json();
      if ('error' in data) throw new Error(String(data.error));
      return data;
    },
    enabled: !!workflowId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const lastSyncedRef = useRef<unknown>(null);
  useEffect(() => {
    const data = query.data;
    if (!data || !('workflow' in data)) return;
    if (lastSyncedRef.current === data) return;
    lastSyncedRef.current = data;

    const { nodes: ns, edges: es } = dbToCanvas(
      data.workflow as { id: string; name: string; triggerType: TriggerType; triggerEvent: TriggerEvent },
      data.steps as ApiStep[],
      (data as { edges: ApiEdge[] }).edges
    );
    setName(data.workflow.name);
    setNodes(ns);
    setEdges(es);
    setStatus(data.workflow.status === 'active' ? 'active' : 'draft');
  }, [query.data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { name: n, nodes: ns, edges: es } = stateRef.current;
      const payload = canvasToDb(n, ns, es);
      if (workflowId) {
        const res = await client.workflows[':id'].$put({
          param: { id: workflowId },
          json: payload,
        });
        if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
        return res.json();
      }
      const res = await client.workflows.$post({ json: payload });
      if (!res.ok) throw new Error(`Save failed (${res.status}): ${await res.text()}`);
      return res.json();
    },
    onSuccess: (data) => {
      setLastError(null);
      if (!workflowId && 'workflow' in data && data.workflow?.id) {
        navigate(`/workflow/${data.workflow.id}`, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
    onError: (err) => {
      setLastError(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!workflowId) throw new Error('Cannot publish unsaved workflow');
      const res = await client.workflows[':id'].publish.$patch({
        param: { id: workflowId },
      });
      if (!res.ok) throw new Error(`Publish failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      setLastError(null);
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
    onError: (err) => {
      setLastError(`Failed to publish: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const applyEdit = useCallback((next: { nodes?: CanvasNode[]; edges?: Edge[] }) => {
    if (next.nodes) setNodes(next.nodes);
    if (next.edges) setEdges(next.edges);
  }, []);

  const save = useCallback(async (): Promise<SaveResult> => {
    try {
      const data = await saveMutation.mutateAsync();
      if ('workflow' in data && data.workflow?.id) return { id: data.workflow.id };
      return { error: 'Save returned no workflow id' };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }, [saveMutation]);

  const publish = useCallback(async (): Promise<PublishResult> => {
    try {
      await publishMutation.mutateAsync();
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }, [publishMutation]);

  return {
    name,
    setName,
    nodes,
    edges,
    status,
    isLoading: query.isLoading,
    isReady: !workflowId || query.isFetched,
    save,
    publish,
    saveState: mutationState(saveMutation.isPending, saveMutation.isError),
    publishState: mutationState(publishMutation.isPending, publishMutation.isError),
    lastError,
    applyEdit,
  };
}
