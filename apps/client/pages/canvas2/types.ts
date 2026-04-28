import type {
  WaitConfig,
  BranchConfig,
  SendConfig,
  FilterConfig,
  ExitConfig,
} from '../../../server/db/schema';

import type { StepConfig as ServerStepConfig } from '../../../server/db/schema';

export type { WaitConfig, BranchConfig, SendConfig, FilterConfig, ExitConfig };
export type StepConfig = ServerStepConfig;

export type TriggerType = 'system' | 'custom';

export interface TriggerData {
  triggerType: TriggerType;
  event: string;
}

export type LeafNode =
  | { id: string; kind: 'wait'; config: WaitConfig }
  | { id: string; kind: 'send'; config: SendConfig }
  | { id: string; kind: 'filter'; config: FilterConfig }
  | { id: string; kind: 'exit'; config: ExitConfig };

export interface BranchNode {
  id: string;
  kind: 'branch';
  config: BranchConfig;
  yes: TreeNode[];
  no: TreeNode[];
}

export type TreeNode = LeafNode | BranchNode;

export type StepKind = TreeNode['kind'];

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';

export interface WorkflowTree {
  name: string;
  trigger: TriggerData;
  root: TreeNode[];
  status?: WorkflowStatus;
}

export type ChainPath = { branchId: string; side: 'yes' | 'no' }[];

export interface ConnectorLocation {
  chainPath: ChainPath;
  index: number;
}
