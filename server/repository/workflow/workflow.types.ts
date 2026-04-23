export type StepInput = {
  id: string;
  workflowId: string;
  type: "wait" | "branch" | "send";
  config: Record<string, unknown>;
};

export type EdgeInput = {
  workflowId: string;
  source: string;
  target: string;
  handle: string | null;
};
