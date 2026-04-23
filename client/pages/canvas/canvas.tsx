import { useCallback, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Connection,
  type Edge,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

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
import { useUserColumns, useWorkflow, useSaveWorkflow } from './hooks';

function CanvasInner({ workflowId }: { workflowId?: string }) {
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const { data: userColumns = [] } = useUserColumns();

  useWorkflow(workflowId, (name, loadedNodes, loadedEdges) => {
    setWorkflowName(name);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
  });

  const saveMutation = useSaveWorkflow(workflowId, workflowName, nodes, edges);

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
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges]
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

      setNodes((nds) => [...nds, newNode]);
    },
    [screenToFlowPosition, setNodes]
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
    [setNodes]
  );

  return (
    <div className="flex h-full min-h-0">
      <StepPalette />

      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-14 border-b border-gray-200 bg-white px-4 flex items-center justify-between">
          <input
            type="text"
            placeholder="Workflow name"
            className="text-lg font-semibold border-none outline-none bg-transparent"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Canvas */}
        <div className="flex-1 flex">
          <div className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onNodeClick={onNodeClick}
              onPaneClick={onPaneClick}
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={[15, 15]}
            >
              <Background gap={15} size={1} />
              <Controls />
            </ReactFlow>
          </div>

          {selectedNode && (
            <ConfigPanel
              node={selectedNode}
              onUpdate={(config) => updateNodeData(selectedNode.id, config)}
              onClose={() => setSelectedNodeId(null)}
              userColumns={userColumns}
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
