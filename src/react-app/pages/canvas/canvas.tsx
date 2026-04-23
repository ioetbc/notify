import { useCallback, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
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

export function Canvas() {
  const { id: urlId } = useParams<{ id: string }>();
  const workflowId = urlId === 'new' ? undefined : urlId;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');

  const { data: userColumns = [] } = useUserColumns();

  useWorkflow(workflowId, (name, loadedNodes, loadedEdges) => {
    setWorkflowName(name);
    setNodes(loadedNodes);
    setEdges(loadedEdges);
  });

  const saveMutation = useSaveWorkflow(workflowId, workflowName, nodes, edges);

  const onConnect = useCallback(
    (connection: Connection) => {
      const edge = {
        ...connection,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
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
      if (!type || !reactFlowInstance || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: CanvasNode = {
        id: getNodeId(),
        type,
        position,
        data: createNodeData(type),
      };

      setNodes((nds) => [...nds, newNode]);
    },
    [reactFlowInstance, setNodes]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: CanvasNode) => {
      setSelectedNode(node);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
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
      setSelectedNode((prev) => {
        if (prev && prev.id === nodeId) {
          const updatedData = { ...prev.data, config: newConfig } as StepNodeData;
          return { ...prev, data: updatedData } as CanvasNode;
        }
        return prev;
      });
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
          <div ref={reactFlowWrapper} className="flex-1">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onInit={setReactFlowInstance}
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
              onClose={() => setSelectedNode(null)}
              userColumns={userColumns}
            />
          )}
        </div>
      </div>
    </div>
  );
}
