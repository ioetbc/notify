import { useCallback, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
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

import { client, queryClient } from '../../lib/api';
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

const TRIGGER_EVENTS: TriggerEvent[] = ['contact_added', 'contact_updated', 'event_received'];

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
  dataType: string;
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
  stepType: 'wait' | 'branch' | 'send';
  waitHours: number | null;
  waitNextStepId: string | null;
  branchUserColumn: string | null;
  branchOperator: string | null;
  branchCompareValue: string | null;
  branchTrueStepId: string | null;
  branchFalseStepId: string | null;
  sendTitle: string | null;
  sendBody: string | null;
  sendNextStepId: string | null;
}

function dbToCanvas(
  workflow: { id: string; name: string; triggerEvent: TriggerEvent },
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
      config: { event: workflow.triggerEvent },
      label: 'Trigger',
    },
  };
  nodes.push(triggerNode);

  // Create step nodes
  for (const step of steps) {
    if (step.stepType === 'wait') {
      nodes.push({
        id: step.id,
        type: 'wait' as const,
        position: { x: 0, y: 0 },
        data: {
          type: 'wait' as const,
          config: { hours: step.waitHours || 24 },
          label: 'Wait',
        },
      });
    } else if (step.stepType === 'branch') {
      nodes.push({
        id: step.id,
        type: 'branch' as const,
        position: { x: 0, y: 0 },
        data: {
          type: 'branch' as const,
          config: {
            user_column: step.branchUserColumn || '',
            operator: (step.branchOperator || '=') as BranchNodeData['config']['operator'],
            compare_value: step.branchCompareValue || '',
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
            title: step.sendTitle || 'Notification',
            body: step.sendBody || '',
          },
          label: 'Send',
        },
      });
    }
  }

  // Build edges from step references
  const stepsWithIncoming = new Set<string>();

  for (const step of steps) {
    if (step.stepType === 'wait' && step.waitNextStepId) {
      edges.push({
        id: `${step.id}-${step.waitNextStepId}`,
        source: step.id,
        target: step.waitNextStepId,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      stepsWithIncoming.add(step.waitNextStepId);
    } else if (step.stepType === 'send' && step.sendNextStepId) {
      edges.push({
        id: `${step.id}-${step.sendNextStepId}`,
        source: step.id,
        target: step.sendNextStepId,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
      stepsWithIncoming.add(step.sendNextStepId);
    } else if (step.stepType === 'branch') {
      if (step.branchTrueStepId) {
        edges.push({
          id: `${step.id}-yes-${step.branchTrueStepId}`,
          source: step.id,
          target: step.branchTrueStepId,
          sourceHandle: 'yes',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        });
        stepsWithIncoming.add(step.branchTrueStepId);
      }
      if (step.branchFalseStepId) {
        edges.push({
          id: `${step.id}-no-${step.branchFalseStepId}`,
          source: step.id,
          target: step.branchFalseStepId,
          sourceHandle: 'no',
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed },
        });
        stepsWithIncoming.add(step.branchFalseStepId);
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
  const [workflowName, setWorkflowName] = useState('Untitled Workflow');

  // Fetch user columns
  const { data: userColumns = [] } = useQuery({
    queryKey: ['user-columns'],
    queryFn: async () => {
      const res = await client['user-columns'].$get();
      const data = await res.json();
      return data.columns as UserColumn[];
    },
  });

  // Load existing workflow
  useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: async () => {
      const res = await client.workflows[':id'].$get({ param: { id: workflowId! } });
      if (!res.ok) throw new Error('Failed to load workflow');
      const data = await res.json();
      if ('error' in data) throw new Error(String(data.error));
      setWorkflowName(data.workflow.name);
      const { nodes: layoutedNodes, edges: layoutedEdges } = dbToCanvas(
        data.workflow as { id: string; name: string; triggerEvent: TriggerEvent },
        data.steps as DbStep[]
      );
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      return data;
    },
    enabled: !!workflowId,
  });

  // Save workflow mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const triggerNode = nodes.find((n) => n.data.type === 'trigger');
      const triggerEvent = (triggerNode?.data.type === 'trigger'
        ? triggerNode.data.config.event
        : 'contact_added') as TriggerEvent;

      const stepsPayload = nodes
        .filter((n): n is CanvasNode & { data: WaitNodeData | BranchNodeData | SendNodeData } => n.data.type !== 'trigger')
        .map((n) => {
          const d = n.data;
          if (d.type === 'wait') {
            return { id: n.id, type: 'wait' as const, config: { hours: d.config.hours } };
          } else if (d.type === 'branch') {
            return {
              id: n.id,
              type: 'branch' as const,
              config: {
                user_column: d.config.user_column,
                operator: d.config.operator,
                compare_value: d.config.compare_value ?? null,
              },
            };
          } else {
            return {
              id: n.id,
              type: 'send' as const,
              config: { title: d.config.title, body: d.config.body },
            };
          }
        });

      const canvasEdges = edges
        .filter((e) => e.source !== 'trigger')
        .map((e) => ({
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
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
        return res.json();
      }
    },
    onSuccess: (data) => {
      if (!workflowId && 'workflow' in data && data.workflow?.id) {
        navigate(`/canvas/${data.workflow.id}`, { replace: true });
      }
      queryClient.invalidateQueries({ queryKey: ['workflow'] });
    },
    onError: (err) => {
      alert(`Failed to save: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

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
              triggerEvents={TRIGGER_EVENTS}
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

  const selectedAttribute = userColumns.find((col) => col.name === config.user_column);
  const dataType = selectedAttribute?.dataType;

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
              {col.name} ({col.dataType})
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
