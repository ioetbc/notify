import { useCallback, useRef, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { getLayoutedElements } from './layout';
import type {
  StepType,
  TriggerEvent,
  StepNodeData,
  TriggerNodeData,
  WaitNodeData,
  BranchNodeData,
  SendNodeData,
} from './types';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

// Format trigger event for display (e.g., "contact_added" -> "Contact Added")
function formatTriggerEvent(event: string): string {
  return event
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

interface UserColumn {
  id: string;
  name: string;
  data_type: 'text' | 'boolean' | 'number';
}

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
        config: { user_column: '', operator: '=', compare_value: '' },
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

// Convert DB workflow response to canvas nodes/edges
interface DbStep {
  id: string;
  step_type: 'wait' | 'branch' | 'send';
  wait_hours?: number;
  wait_next_step_id?: string;
  branch_user_column?: string;
  branch_operator?: string;
  branch_compare_value?: string;
  branch_true_step_id?: string;
  branch_false_step_id?: string;
  send_title?: string;
  send_body?: string;
  send_next_step_id?: string;
}

function dbToCanvas(
  workflow: { id: string; name: string; trigger_event: TriggerEvent },
  steps: DbStep[]
): { nodes: CanvasNode[]; edges: Edge[] } {
  const nodes: CanvasNode[] = [];
  const edges: Edge[] = [];

  // Create trigger node
  const triggerNode: CanvasNode = {
    id: 'trigger',
    type: 'trigger' as const,
    position: { x: 0, y: 0 },
    data: {
      type: 'trigger' as const,
      config: { event: workflow.trigger_event },
      label: 'Trigger',
    },
  };
  nodes.push(triggerNode);

  // Create step nodes
  for (const step of steps) {
    if (step.step_type === 'wait') {
      nodes.push({
        id: step.id,
        type: 'wait' as const,
        position: { x: 0, y: 0 },
        data: {
          type: 'wait' as const,
          config: { hours: step.wait_hours || 24 },
          label: 'Wait',
        },
      });
    } else if (step.step_type === 'branch') {
      nodes.push({
        id: step.id,
        type: 'branch' as const,
        position: { x: 0, y: 0 },
        data: {
          type: 'branch' as const,
          config: {
            user_column: step.branch_user_column || '',
            operator: (step.branch_operator || '=') as BranchNodeData['config']['operator'],
            compare_value: step.branch_compare_value || '',
          },
          label: 'Branch',
        },
      });
    } else {
      nodes.push({
        id: step.id,
        type: 'send' as const,
        position: { x: 0, y: 0 },
        data: {
          type: 'send' as const,
          config: {
            title: step.send_title || 'Notification',
            body: step.send_body || '',
          },
          label: 'Send',
        },
      });
    }
  }

  // Build edges from step references
  const stepsWithIncoming = new Set<string>();

  for (const step of steps) {
    if (step.step_type === 'wait' && step.wait_next_step_id) {
      edges.push({
        id: `${step.id}-${step.wait_next_step_id}`,
        source: step.id,
        target: step.wait_next_step_id,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      stepsWithIncoming.add(step.wait_next_step_id);
    } else if (step.step_type === 'send' && step.send_next_step_id) {
      edges.push({
        id: `${step.id}-${step.send_next_step_id}`,
        source: step.id,
        target: step.send_next_step_id,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      stepsWithIncoming.add(step.send_next_step_id);
    } else if (step.step_type === 'branch') {
      if (step.branch_true_step_id) {
        edges.push({
          id: `${step.id}-yes-${step.branch_true_step_id}`,
          source: step.id,
          target: step.branch_true_step_id,
          sourceHandle: 'yes',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        });
        stepsWithIncoming.add(step.branch_true_step_id);
      }
      if (step.branch_false_step_id) {
        edges.push({
          id: `${step.id}-no-${step.branch_false_step_id}`,
          source: step.id,
          target: step.branch_false_step_id,
          sourceHandle: 'no',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        });
        stepsWithIncoming.add(step.branch_false_step_id);
      }
    }
  }

  // Connect trigger to first step (step with no incoming edges)
  for (const step of steps) {
    if (!stepsWithIncoming.has(step.id)) {
      edges.push({
        id: `trigger-${step.id}`,
        source: 'trigger',
        target: step.id,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      break; // Only connect to first root step
    }
  }

  // Apply auto-layout
  const layouted = getLayoutedElements(nodes, edges);
  return layouted;
}

export function Canvas() {
  const { id: urlId } = useParams<{ id: string }>();
  // Treat "new" as creating a new workflow
  const workflowId = urlId === 'new' ? undefined : urlId;
  const navigate = useNavigate();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<CanvasNode, Edge> | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNode, setSelectedNode] = useState<CanvasNode | null>(null);
  const [userColumns, setUserColumns] = useState<UserColumn[]>([]);
  const [triggerEvents, setTriggerEvents] = useState<TriggerEvent[]>([]);
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      if (!API_URL) return;
      try {
        const [columnsRes, enumsRes] = await Promise.all([
          fetch(`${API_URL}/user-columns`),
          fetch(`${API_URL}/enums`),
        ]);

        const columnsData = await columnsRes.json();
        setUserColumns(columnsData.columns || []);

        const enumsData = await enumsRes.json();
        setTriggerEvents(enumsData.trigger_event || []);
      } catch (err) {
        console.error('Failed to fetch data:', err);
      }
    }
    fetchData();
  }, []);

  // Load existing workflow
  useEffect(() => {
    async function loadWorkflow() {
      if (!workflowId || !API_URL) return;
      try {
        const res = await fetch(`${API_URL}/workflows/${workflowId}`);
        if (!res.ok) {
          console.error('Failed to load workflow');
          return;
        }
        const data = await res.json();
        setWorkflowName(data.workflow.name);
        const { nodes: layoutedNodes, edges: layoutedEdges } = dbToCanvas(data.workflow, data.steps);
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (err) {
        console.error('Failed to load workflow:', err);
      }
    }
    loadWorkflow();
  }, [workflowId, setNodes, setEdges]);

  const saveWorkflow = useCallback(async () => {
    console.log('saveWorkflow called');
    console.log('API_URL:', API_URL);
    console.log('workflowId:', workflowId);
    console.log('nodes:', nodes);
    console.log('edges:', edges);

    if (!API_URL) {
      console.error('API_URL not configured');
      alert('API URL not configured. Set VITE_API_URL in .env');
      return;
    }

    setIsSaving(true);
    try {
      // Find trigger node to get trigger_event
      const triggerNode = nodes.find((n) => n.data.type === 'trigger');
      const triggerEvent = triggerNode?.data.type === 'trigger'
        ? triggerNode.data.config.event
        : 'contact_added';

      // Filter out trigger node for steps
      const steps = nodes
        .filter((n) => n.data.type !== 'trigger')
        .map((n) => ({
          id: n.id,
          type: n.data.type as 'wait' | 'branch' | 'send',
          config: n.data.config,
        }));

      // Filter out edges from trigger (we'll reconstruct on load)
      const canvasEdges = edges
        .filter((e) => e.source !== 'trigger')
        .map((e) => ({
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
        }));

      const payload = {
        name: workflowName,
        trigger_event: triggerEvent,
        steps,
        edges: canvasEdges,
      };

      console.log('Saving workflow:', payload);

      const url = workflowId
        ? `${API_URL}/workflows/${workflowId}`
        : `${API_URL}/workflows`;

      const res = await fetch(url, {
        method: workflowId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error('Server error:', data);
        alert(`Failed to save: ${data.error || res.statusText}`);
        return;
      }

      console.log('Saved successfully:', data);

      // If creating new workflow, navigate to edit URL
      if (!workflowId && data.workflow?.id) {
        navigate(`/canvas/${data.workflow.id}`, { replace: true });
      }
    } catch (err) {
      console.error('Failed to save workflow:', err);
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  }, [nodes, edges, workflowName, workflowId, navigate]);

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
        <div className="h-14 border-b border-gray-200 bg-white px-4 flex items-center justify-between">
          <input
            type="text"
            placeholder="Workflow name"
            className="text-lg font-semibold border-none outline-none bg-transparent"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
          />
          <button
            onClick={saveWorkflow}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? 'Saving...' : 'Save'}
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
              userColumns={userColumns}
              triggerEvents={triggerEvents}
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
  userColumns: UserColumn[];
  triggerEvents: TriggerEvent[];
}

function ConfigPanel({ node, onUpdate, onClose, userColumns, triggerEvents }: ConfigPanelProps) {
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
          triggerEvents={triggerEvents}
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
          userColumns={userColumns}
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
  triggerEvents,
}: {
  config: TriggerNodeData['config'];
  onUpdate: (config: TriggerNodeData['config']) => void;
  triggerEvents: TriggerEvent[];
}) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">Trigger Event</label>
      <select
        value={config.event}
        onChange={(e) => onUpdate({ event: e.target.value as TriggerEvent })}
        className="w-full border border-gray-300 rounded px-3 py-2"
      >
        {triggerEvents.map((event) => (
          <option key={event} value={event}>
            {formatTriggerEvent(event)}
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
  userColumns,
}: {
  config: BranchNodeData['config'];
  onUpdate: (config: BranchNodeData['config']) => void;
  userColumns: UserColumn[];
}) {
  const operators = ['=', '!=', 'exists', 'not_exists'] as const;
  const needsValue = config.operator === '=' || config.operator === '!=';

  // Find the selected attribute to get its data type
  const selectedAttribute = userColumns.find((col) => col.name === config.user_column);
  const dataType = selectedAttribute?.data_type;

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm text-gray-700 mb-1">Attribute</label>
        <select
          value={config.user_column}
          onChange={(e) => onUpdate({ ...config, user_column: e.target.value, compare_value: '' })}
          className="w-full border border-gray-300 rounded px-3 py-2"
        >
          <option value="">Select an attribute...</option>
          {userColumns.map((col) => (
            <option key={col.id} value={col.name}>
              {col.name} ({col.data_type})
            </option>
          ))}
        </select>
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
      {needsValue && selectedAttribute && (
        <div>
          <label className="block text-sm text-gray-700 mb-1">Compare Value</label>
          {dataType === 'boolean' && (
            <select
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              <option value="">Select...</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          )}
          {dataType === 'number' && (
            <input
              type="number"
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Enter a number"
            />
          )}
          {dataType === 'text' && (
            <input
              type="text"
              value={config.compare_value || ''}
              onChange={(e) => onUpdate({ ...config, compare_value: e.target.value })}
              className="w-full border border-gray-300 rounded px-3 py-2"
              placeholder="Enter text"
            />
          )}
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
