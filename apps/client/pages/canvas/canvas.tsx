import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Panel,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Undo2, Redo2 } from 'lucide-react';

import { nodeTypes } from './nodes';
import { StepPalette } from './step-palette';
import type {
  StepType,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
} from './types';
import { createNodeData, createInitialWorkflow, getNodeId, type CanvasNode } from './utils';
import { ConfigPanel } from './config-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserColumns, useEventNames, useWorkflow, useSaveWorkflow, usePublishWorkflow } from './hooks';

type Snapshot = { nodes: CanvasNode[]; edges: Edge[] };

function CanvasInner({ workflowId }: { workflowId?: string }) {
  const { screenToFlowPosition } = useReactFlow();
  const initial = workflowId ? { nodes: [], edges: [] } : createInitialWorkflow();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [workflowStatus, setWorkflowStatus] = useState<'draft' | 'active'>('draft');

  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const stateRef = useRef<Snapshot>({ nodes, edges });
  useEffect(() => { stateRef.current = { nodes, edges }; }, [nodes, edges]);

  const commit = useCallback(() => {
    setPast((p) => [...p, stateRef.current]);
    setFuture([]);
  }, []);

  const undo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const prev = p[p.length - 1];
      setFuture((f) => [...f, stateRef.current]);
      setNodes(prev.nodes);
      setEdges(prev.edges);
      return p.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, stateRef.current]);
      setNodes(next.nodes);
      setEdges(next.edges);
      return f.slice(0, -1);
    });
  }, [setNodes, setEdges]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  const handleNodesChange = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      const significant = changes.some((c) => c.type === 'remove' || (c.type === 'position' && c.dragging === false));
      if (significant) commit();
      onNodesChange(changes);
    },
    [onNodesChange, commit]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === 'remove')) commit();
      onEdgesChange(changes);
    },
    [onEdgesChange, commit]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const { data: userColumns = [] } = useUserColumns();
  const { data: eventNames = [] } = useEventNames();

  useWorkflow(workflowId, (name, loadedNodes, loadedEdges, status) => {
    setWorkflowName(name);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
    setWorkflowStatus(status === 'active' ? 'active' : 'draft');
  });

  const saveMutation = useSaveWorkflow(workflowId, workflowName, nodes, edges);
  const publishMutation = usePublishWorkflow(workflowId);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (connection.source === connection.target) return false;

      const exists = edges.some(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          e.sourceHandle === (connection.sourceHandle ?? null)
      );

      if (exists) return false;

      const visited = new Set<string>();
      const queue = [connection.target];

      while (queue.length > 0) {
        const current = queue.pop()!;
        if (current === connection.source) return false;
        if (visited.has(current)) continue;
        visited.add(current);
        for (const e of edges) {
          if (e.source === current) queue.push(e.target);
        }
      }

      return true;
    },
    [edges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const label = connection.sourceHandle === 'yes'
        ? 'Yes'
        : connection.sourceHandle === 'no'
          ? 'No'
          : undefined;

      const edge = {
        ...connection,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
        ...(label && { label }),
      };
      commit();
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges, commit]
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/steptype') as StepType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const newNode: CanvasNode = {
        id: getNodeId(),
        type,
        position,
        data: createNodeData(type),
      };

      commit();
      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes, commit]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: CanvasNode) => {
      setSelectedNodeId(node.id);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const updateNodeData = useCallback(
    (nodeId: string, newConfig: TriggerNodeData['config'] | WaitNodeData['config'] | BranchNodeData['config'] | SendNodeData['config']) => {
      commit();
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            const updatedData = { ...node.data, config: newConfig } as StepNodeData;
            return { ...node, data: updatedData } as CanvasNode;
          }
          return node;
        })
      );
    },
    [setNodes, commit]
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col relative">
        {/* Toolbar */}
        <div className="absolute top-0 left-0 right-0 h-14 px-4 flex items-center justify-end z-10 pointer-events-none [&_input]:pointer-events-auto [&_button]:pointer-events-auto [&_span]:pointer-events-auto">
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Workflow name"
              className="text-lg font-semibold border-none outline-none bg-transparent text-right"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
            />
            <Select
              value={workflowStatus}
              onValueChange={(value) => {
                if (value === 'active' && workflowStatus !== 'active' && workflowId) {
                  publishMutation.mutate(undefined, {
                    onSuccess: () => setWorkflowStatus('active'),
                  });
                }
              }}
              disabled={!workflowId || publishMutation.isPending || workflowStatus === 'active'}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft" disabled={workflowStatus === 'active'}>Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="absolute inset-0 flex bg-gray-50">
          <div className="flex-1 relative">
            <StepPalette />
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ maxZoom: 1.4, padding: 0.15 }}
              snapToGrid
              snapGrid={[15, 15]}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={30} size={0.75} />
              <Panel position="bottom-center">
                <ButtonGroup aria-label="History">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={undo}
                    disabled={past.length === 0}
                    aria-label="Undo"
                    title="Undo (⌘Z)"
                  >
                    <Undo2 />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={redo}
                    disabled={future.length === 0}
                    aria-label="Redo"
                    title="Redo (⇧⌘Z)"
                  >
                    <Redo2 />
                  </Button>
                </ButtonGroup>
              </Panel>
            </ReactFlow>
          </div>

          {selectedNode && (
            <ConfigPanel
              node={selectedNode}
              onUpdate={(config) => updateNodeData(selectedNode.id, config)}
              onClose={() => setSelectedNodeId(null)}
              userColumns={userColumns}
              eventNames={eventNames}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function Canvas({ workflowId }: { workflowId?: string }) {
  return (
    <ReactFlowProvider>
      <CanvasInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
