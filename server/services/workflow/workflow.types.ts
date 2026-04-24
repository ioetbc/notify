import type { WaitConfig, BranchConfig, SendConfig, FilterConfig } from "../../db/schema";

export type CanvasStep =
  | { id: string; type: "wait"; config: WaitConfig }
  | { id: string; type: "branch"; config: BranchConfig }
  | { id: string; type: "send"; config: SendConfig }
  | { id: string; type: "filter"; config: FilterConfig };

export type CanvasEdge = {
  source: string;
  target: string;
  handle?: boolean;
};

export type TriggerInput =
  | { trigger_type: "system"; trigger_event: "user_created" | "user_updated" }
  | { trigger_type: "custom"; trigger_event: string };

export type CreateWorkflowInput = {
  name: string;
  steps: CanvasStep[];
  edges: CanvasEdge[];
} & TriggerInput;

export type UpdateWorkflowInput = {
  name: string;
  steps: CanvasStep[];
  edges: CanvasEdge[];
} & TriggerInput;
