import { useCallback, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
  type Node,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './nodes';
import { StepPalette } from './step-palette';
import type {
  StepType,
  TriggerEvent,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
} from './types';

const TRIGGER_EVENTS: { value: TriggerEvent; label: string }[] = [
  { value: 'contact_added', label: 'Contact Added' },
  { value: 'contact_updated', label: 'Contact Updated' },
  { value: 'event_received', label: 'Event Received' },
];

type CanvasNode = Node<StepNodeData, StepType>;

function createNodeData(type: StepType): StepNodeData {
  switch (type) {
    case 'trigger':
      return {
        type: 'trigger',
        config: { event: 'contact_added' },
        label: 'Trigger',
      } as TriggerNodeData;
    case 'wait':
      return {
        type: 'wait',
        config: { hours: 24 },
        label: 'Wait',
      } as WaitNodeData;
    case 'branch':
      return {
        type: 'branch',
        config: { user_column: 'plan', operator: '=', compare_value: 'pro' },
        label: 'Branch',
      } as BranchNodeData;
    case 'send':
      return {
        type: 'send',
        config: { title: 'Notification', body: 'Your message here' },
        label: 'Send',
      } as SendNodeData;
  }
}

let nodeId = 0;
function getNodeId() {
  return `step_${nodeId++}`;
}

export function Canvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);

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
            // Cast to any to avoid complex union type issues
            const updatedData = { ...node.data, config: newConfig } as StepNodeData;
            return { ...node, data: updatedData } as CanvasNode;
          }
          return node;
        })
      );
      // Also update selected node if it matches
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
        <div className="h-14 border-b border-gray-200 bg-white px-4 flex items-center gap-4">
          <input
            type="text"
            placeholder="Workflow name"
            className="text-lg font-semibold border-none outline-none bg-transparent"
            defaultValue="Untitled Workflow"
          />
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
              <MiniMap
                nodeColor={(node) => {
                  switch (node.type) {
                    case 'wait':
                      return '#fbbf24';
                    case 'branch':
                      return '#a855f7';
                    case 'send':
                      return '#3b82f6';
                    default:
                      return '#6b7280';
                  }
                }}
              />
            </ReactFlow>
          </div>

          {/* Config Panel */}
          {selectedNode && (
            <ConfigPanel
              node={selectedNode}
              onUpdate={(config) => updateNodeData(selectedNode.id, config)}
              onClose={() => setSelectedNode(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface ConfigPanelProps {
  node: CanvasNode;
  onUpdate: (config: TriggerNodeData['config'] | WaitNodeData['config'] | BranchNodeData['config'] | SendNodeData['config']) => void;
  onClose: () => void;
}

function ConfigPanel({ node, onUpdate, onClose }: ConfigPanelProps) {
  const data = node.data;

  return (
    <div className="w-72 border-l border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900 capitalize">{data.type} Step</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
        >
          ×
        </button>
      </div>

      {data.type === 'trigger' && (
        <TriggerConfig
          config={data.config}
          onUpdate={onUpdate}
        />
      )}
      {data.type === 'wait' && (
        <WaitConfig
          config={data.config}
          onUpdate={onUpdate}
        />
      )}
      {data.type === 'branch' && (
        <BranchConfig
          config={data.config}
          onUpdate={onUpdate}
        />
      )}
      {data.type === 'send' && (
        <SendConfig
          config={data.config}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
}

function TriggerConfig({
  config,
  onUpdate,
}: {
  config: TriggerNodeData['config'];
  onUpdate: (config: TriggerNodeData['config']) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">Trigger Event</label>
      <select
        value={config.event}
        onChange={(e) => onUpdate({ event: e.target.value as TriggerEvent })}
        className="w-full border border-gray-300 rounded px-3 py-2"
      >
        {TRIGGER_EVENTS.map((event) => (
          <option key={event.value} value={event.value}>
            {event.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500 mt-2">
        This workflow will start when this event occurs.
      </p>
    </div>
  );
}

function WaitConfig({
  config,
  onUpdate,
}: {
  config: WaitNodeData['config'];
  onUpdate: (config: WaitNodeData['config']) => void;
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">Wait Duration (hours)</label>
      <input
        type="number"
        value={config.hours}
        onChange={(e) => onUpdate({ hours: parseInt(e.target.value, 10) || 1 })}
        min={1}
        max={720}
        className="w-full border border-gray-300 rounded px-3 py-2"
      />
      <p className="text-xs text-gray-500 mt-1">
        {config.hours >= 24
          ? `= ${Math.floor(config.hours / 24)} days ${config.hours % 24} hours`
          : `= ${config.hours} hours`}
      </p>
    </div>
  );
}

function BranchConfig({
  config,
  onUpdate,
}: {
  config: BranchNodeData['config'];
  onUpdate: (config: BranchNodeData['config']) => void;
}) {
  const operators = ['=', '!=', 'exists', 'not_exists'] as const;
  const needsValue = config.operator === '=' || config.operator === '!=';

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1">User Column</label>
        <input
          type="text"
          value={config.user_column}
          onChange={(e) => onUpdate({ ...config, user_column: e.target.value })}
          placeholder="e.g., plan, gender, phone"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Operator</label>
        <select
          value={config.operator}
          onChange={(e) =>
            onUpdate({ ...config, operator: e.target.value as typeof config.operator })
          }
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          {operators.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>
      {needsValue && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">Compare Value</label>
          <input
            type="text"
            value={config.compare_value || ''}
            onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
        </div>
      )}
    </div>
  );
}

function SendConfig({
  config,
  onUpdate,
}: {
  config: SendNodeData['config'];
  onUpdate: (config: SendNodeData['config']) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Title <span className="text-gray-400">({config.title.length}/50)</span>
        </label>
        <input
          type="text"
          value={config.title}
          onChange={(e) => onUpdate({ ...config, title: e.target.value.slice(0, 50) })}
          maxLength={50}
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">
          Body <span className="text-gray-400">({config.body.length}/150)</span>
        </label>
        <textarea
          value={config.body}
          onChange={(e) => onUpdate({ ...config, body: e.target.value.slice(0, 150) })}
          maxLength={150}
          rows={3}
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>
    </div>
  );
}
