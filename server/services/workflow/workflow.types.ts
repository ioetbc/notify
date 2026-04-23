import type { WaitConfig, BranchConfig, SendConfig, FilterConfig } from "../../db/schema";

export type CanvasStep =
  | { id: string; type: "wait"; config: WaitConfig }
  | { id: string; type: "branch"; config: BranchConfig }
  | { id: string; type: "send"; config: SendConfig }
  | { id: string; type: "filter"; config: FilterConfig };

export type CanvasEdge = {
  source: string;
  target: string;
  handle?: string;
};

export type CreateWorkflowInput = {
  name: string;
  trigger_event: string;
  steps: CanvasStep[];
  edges: CanvasEdge[];
};

export type UpdateWorkflowInput = {
  name: string;
  trigger_event: string;
  steps: CanvasStep[];
  edges: CanvasEdge[];
};
