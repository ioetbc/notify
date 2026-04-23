import type { Node, Edge } from '@xyflow/react';
import type {
  WaitConfig,
  BranchConfig,
  SendConfig,
  FilterConfig,
  StepConfig,
} from '../../../server/db/schema';

// Re-export config types for convenience
export type { WaitConfig, BranchConfig, SendConfig, FilterConfig, StepConfig };

// Enums matching server/database schema
export type StepType = 'wait' | 'branch' | 'send' | 'filter' | 'trigger';
export type TriggerEvent = string;
export type BranchOperator = '=' | '!=' | 'exists' | 'not_exists';

// Step configurations
export interface TriggerConfig {
  event: TriggerEvent;
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

export interface FilterNodeData extends Record<string, unknown> {
  type: 'filter';
  config: FilterConfig;
  label: string;
}

export type StepNodeData = TriggerNodeData | WaitNodeData | BranchNodeData | SendNodeData | FilterNodeData;

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
