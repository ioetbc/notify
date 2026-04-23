import type { StepConfig } from "../../db/schema";

export type StepInput = {
  id: string;
  workflowId: string;
  type: "wait" | "branch" | "send";
  config: StepConfig;
};

export type EdgeInput = {
  workflowId: string;
  source: string;
  target: string;
  handle: string | null;
};
