import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Panel,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
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
import { createNodeData, getNodeId, type CanvasNode } from './utils';
import { ConfigPanel } from './config-panel';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUserColumns, useEventNames } from './hooks';
import { useWorkflowSession } from './workflow-session';

type Snapshot = { nodes: CanvasNode[]; edges: Edge[] };

function CanvasInner({ workflowId }: { workflowId?: string }) {
  const { screenToFlowPosition } = useReactFlow();
  const session = useWorkflowSession(workflowId);
  const { nodes, edges, applyEdit } = session;

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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
      applyEdit({ nodes: prev.nodes, edges: prev.edges });
      return p.slice(0, -1);
    });
  }, [applyEdit]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[f.length - 1];
      setPast((p) => [...p, stateRef.current]);
      applyEdit({ nodes: next.nodes, edges: next.edges });
      return f.slice(0, -1);
    });
  }, [applyEdit]);

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
      applyEdit({ nodes: applyNodeChanges(changes, stateRef.current.nodes) });
    },
    [applyEdit, commit]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (changes.some((c) => c.type === 'remove')) commit();
      applyEdit({ edges: applyEdgeChanges(changes, stateRef.current.edges) });
    },
    [applyEdit, commit]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const { data: userColumns = [] } = useUserColumns();
  const { data: eventNames = [] } = useEventNames();

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
      applyEdit({ edges: addEdge(edge, stateRef.current.edges) });
    },
    [applyEdit, commit]
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
      applyEdit({ nodes: [...stateRef.current.nodes, newNode] });
    },
    [screenToFlowPosition, applyEdit, commit]
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
      applyEdit({
        nodes: stateRef.current.nodes.map((node) => {
          if (node.id === nodeId) {
            const updatedData = { ...node.data, config: newConfig } as StepNodeData;
            return { ...node, data: updatedData } as CanvasNode;
          }
          return node;
        }),
      });
    },
    [applyEdit, commit]
  );

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 flex flex-col relative">
        {/* Toolbar */}
        <div className="absolute top-0 left-0 right-0 h-14 px-4 flex items-center justify-end z-10 pointer-events-none [&_input]:pointer-events-auto [&_button]:pointer-events-auto [&_span]:pointer-events-auto">
          <div className="flex items-center gap-3">
            {session.lastError && (
              <span className="text-sm text-red-600" role="alert">
                {session.lastError}
              </span>
            )}
            <input
              type="text"
              placeholder="Workflow name"
              className="text-lg font-semibold border-none outline-none bg-transparent text-right"
              value={session.name}
              onChange={(e) => session.setName(e.target.value)}
            />
            <Select
              value={session.status}
              onValueChange={(value) => {
                if (value === 'active' && session.status !== 'active' && workflowId) {
                  void session.publish();
                }
              }}
              disabled={!workflowId || session.publishState === 'pending' || session.status === 'active'}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft" disabled={session.status === 'active'}>Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={() => void session.save()}
              disabled={session.saveState === 'pending'}
            >
              {session.saveState === 'pending' ? 'Saving...' : 'Save'}
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
