import type { Node, Edge } from '@xyflow/react';

// Enums matching server/database schema
export type StepType = 'wait' | 'branch' | 'send' | 'trigger';
export type TriggerEvent = 'contact_added' | 'contact_updated' | 'event_received';
export type BranchOperator = '=' | '!=' | 'exists' | 'not_exists';

// Step configurations
export interface TriggerConfig {
  event: TriggerEvent;
}

export interface WaitConfig {
  hours: number;
}

export interface BranchConfig {
  user_column: string;
  operator: BranchOperator;
  compare_value?: string;
}

export interface SendConfig {
  title: string;
  body: string;
}

// Node data types - must extend Record<string, unknown> for xyflow
export interface TriggerNodeData extends Record<string, unknown> {
  type: 'trigger';
  config: TriggerConfig;
  label: string;
}

export interface WaitNodeData extends Record<string, unknown> {
  type: 'wait';
  config: WaitConfig;
  label: string;
}

export interface BranchNodeData extends Record<string, unknown> {
  type: 'branch';
  config: BranchConfig;
  label: string;
}

export interface SendNodeData extends Record<string, unknown> {
  type: 'send';
  config: SendConfig;
  label: string;
}

export type StepNodeData = TriggerNodeData | WaitNodeData | BranchNodeData | SendNodeData;

// Custom node types for xyflow
export type StepNode = Node<StepNodeData, StepType>;
export type StepEdge = Edge;

// Workflow state
export interface WorkflowCanvasState {
  name: string;
  triggerEvent: TriggerEvent;
  nodes: StepNode[];
  edges: StepEdge[];
}
