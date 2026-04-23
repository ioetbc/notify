import type { WaitConfig, BranchConfig, SendConfig } from "../../db/schema";

export type CanvasStep =
  | { id: string; type: "wait"; config: WaitConfig }
  | { id: string; type: "branch"; config: BranchConfig }
  | { id: string; type: "send"; config: SendConfig };

export type CanvasEdge = {
  source: string;
  target: string;
  handle?: string;
};

export type CreateWorkflowInput = {
  name: string;
  trigger_event: "contact_added" | "contact_updated" | "event_received";
  steps: CanvasStep[];
  edges: CanvasEdge[];
};

export type UpdateWorkflowInput = {
  name: string;
  trigger_event: "contact_added" | "contact_updated" | "event_received";
  steps: CanvasStep[];
  edges: CanvasEdge[];
};
