import type { StepConfig } from './types';

export interface ApiStep {
  id: string;
  type: 'wait' | 'branch' | 'send' | 'filter' | 'exit';
  config: StepConfig;
}

export interface ApiEdge {
  id: string;
  source: string;
  target: string;
  handle: boolean | null;
}
