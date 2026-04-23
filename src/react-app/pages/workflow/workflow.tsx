import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { client, queryClient } from '../../lib/api';
import type { TriggerEvent } from '../canvas/types';

const TRIGGER_EVENTS: TriggerEvent[] = ['contact_added', 'contact_updated', 'event_received'];
const BRANCH_OPERATORS = ['=', '!=', 'exists', 'not_exists'] as const;

interface Step {
  id: string;
  type: 'wait' | 'branch' | 'send';
  config: Record<string, unknown>;
}

interface EditingState {
  type: 'trigger' | 'step';
  stepId?: string;
  stepType?: string;
}

function getStepLabel(step: Step): string {
  switch (step.type) {
    case 'wait':
      return `Wait ${step.config.hours}h`;
    case 'branch':
      return `If ${step.config.user_column} ${step.config.operator} "${step.config.compare_value}"`;
    case 'send':
      return `Send: "${step.config.title}"`;
    default:
      return step.type;
  }
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

export function WorkflowPage() {
  const [editing, setEditing] = useState<EditingState | null>(null);

  // Fetch workflows list
  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: async () => {
      const res = await client.workflows.$get();
      return res.json();
    },
  });

  const firstWorkflowId = listData && 'workflows' in listData ? listData.workflows[0]?.id : undefined;

  // Fetch single workflow detail
  const { data, isLoading: detailLoading, error } = useQuery({
    queryKey: ['workflow', firstWorkflowId],
    queryFn: async () => {
      const res = await client.workflows[':id'].$get({ param: { id: firstWorkflowId! } });
      const result = await res.json();
      if ('error' in result) throw new Error(result.error);
      return result;
    },
    enabled: !!firstWorkflowId,
  });

  // Update trigger event mutation
  const updateTriggerMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!data || !('workflow' in data)) return;
      await client.workflows[':id'].$put({
        param: { id: data.workflow.id },
        json: {
          trigger_event: value as TriggerEvent,
          name: data.workflow.name,
          steps: [],
          edges: [],
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', firstWorkflowId] });
      setEditing(null);
    },
  });

  // Update step mutation
  const updateStepMutation = useMutation({
    mutationFn: async ({ stepId, updates }: { stepId: string; updates: Record<string, unknown> }) => {
      await client.steps[':id'].$put({
        param: { id: stepId },
        json: updates,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', firstWorkflowId] });
      setEditing(null);
    },
  });

  const loading = listLoading || detailLoading;

  if (loading) return <div className="p-6">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">{error instanceof Error ? error.message : 'Failed to fetch'}</div>;
  if (!data || !('workflow' in data)) return <div className="p-6">No workflows found. Run db:seed first.</div>;

  const workflow = data.workflow;
  const steps = data.steps as Step[];

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">{workflow.name}</h1>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Trigger */}
        <div className="relative group">
          <div className="px-4 py-2 bg-green-100 border border-green-300 rounded-lg font-medium flex items-center gap-2">
            <span>{workflow.triggerEvent}</span>
            <button
              onClick={() => setEditing({ type: 'trigger' })}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-green-200 rounded"
              title="Edit trigger"
            >
              <PencilIcon />
            </button>
          </div>

          {editing?.type === 'trigger' && (
            <EditDropdown
              options={TRIGGER_EVENTS}
              currentValue={workflow.triggerEvent}
              onSelect={(value) => updateTriggerMutation.mutate(value)}
              onClose={() => setEditing(null)}
              saving={updateTriggerMutation.isPending}
            />
          )}
        </div>

        {/* Steps */}
        {steps.map((step) => (
          <div key={step.id} className="flex items-center gap-3">
            <span className="text-gray-400 text-xl">&rarr;</span>
            <div className="relative group">
              <div className="px-4 py-2 bg-blue-100 border border-blue-300 rounded-lg flex items-center gap-2">
                <span>{getStepLabel(step)}</span>
                <button
                  onClick={() =>
                    setEditing({
                      type: 'step',
                      stepId: step.id,
                      stepType: step.type,
                    })
                  }
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-blue-200 rounded"
                  title="Edit step"
                >
                  <PencilIcon />
                </button>
              </div>

              {editing?.type === 'step' &&
                editing.stepId === step.id && (
                  <StepEditPopover
                    step={step}
                    onUpdate={(updates) => updateStepMutation.mutate({ stepId: step.id, updates })}
                    onClose={() => setEditing(null)}
                    saving={updateStepMutation.isPending}
                  />
                )}
            </div>
          </div>
        ))}

        <span className="text-gray-400 text-xl">&rarr;</span>
        <div className="px-4 py-2 bg-gray-100 border border-gray-300 rounded-lg">
          End
        </div>
      </div>
    </div>
  );
}

function EditDropdown({
  options,
  currentValue,
  onSelect,
  onClose,
  saving,
}: {
  options: string[];
  currentValue: string;
  onSelect: (value: string) => void;
  onClose: () => void;
  saving: boolean;
}) {
  return (
    <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[200px]">
      <div className="p-2">
        <div className="text-xs text-gray-500 mb-2 font-medium">
          Select value
        </div>
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onSelect(option)}
            disabled={saving}
            className={`w-full text-left px-3 py-2 rounded hover:bg-gray-100 ${
              option === currentValue ? 'bg-blue-50 text-blue-700' : ''
            } ${saving ? 'opacity-50' : ''}`}
          >
            {option}
          </button>
        ))}
        <div className="border-t mt-2 pt-2">
          <button
            onClick={onClose}
            className="w-full text-left px-3 py-2 text-gray-500 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StepEditPopover({
  step,
  onUpdate,
  onClose,
  saving,
}: {
  step: Step;
  onUpdate: (updates: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const getInitialFormData = (): Record<string, string> => {
    if (step.type === 'wait') {
      return { hours: String(step.config.hours ?? '') };
    }
    if (step.type === 'branch') {
      return {
        user_column: String(step.config.user_column ?? ''),
        operator: String(step.config.operator ?? ''),
        compare_value: String(step.config.compare_value ?? ''),
      };
    }
    if (step.type === 'send') {
      return {
        title: String(step.config.title ?? ''),
        body: String(step.config.body ?? ''),
      };
    }
    return {};
  };
  const [formData, setFormData] = useState<Record<string, string>>(getInitialFormData);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step.type === 'wait') {
      onUpdate({ config: { hours: parseInt(formData.hours as string, 10) } });
    } else {
      onUpdate({ config: formData });
    }
  }

  return (
    <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[280px]">
      <form onSubmit={handleSubmit} className="p-3">
        <div className="text-xs text-gray-500 mb-3 font-medium">
          Edit {step.type} step
        </div>

        {step.type === 'wait' && (
          <div className="mb-3">
            <label className="block text-sm text-gray-700 mb-1">
              Wait hours
            </label>
            <input
              type="number"
              value={formData.hours as string}
              onChange={(e) =>
                setFormData({ ...formData, hours: e.target.value })
              }
              className="w-full border border-gray-300 rounded px-3 py-2"
              min="1"
            />
          </div>
        )}

        {step.type === 'branch' && (
          <>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">
                User column
              </label>
              <input
                type="text"
                value={formData.user_column as string}
                onChange={(e) =>
                  setFormData({ ...formData, user_column: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">
                Operator
              </label>
              <select
                value={formData.operator as string}
                onChange={(e) =>
                  setFormData({ ...formData, operator: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                {BRANCH_OPERATORS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">
                Compare value
              </label>
              <input
                type="text"
                value={formData.compare_value as string}
                onChange={(e) =>
                  setFormData({ ...formData, compare_value: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
          </>
        )}

        {step.type === 'send' && (
          <>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={formData.title as string}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm text-gray-700 mb-1">Body</label>
              <textarea
                value={formData.body as string}
                onChange={(e) =>
                  setFormData({ ...formData, body: e.target.value })
                }
                className="w-full border border-gray-300 rounded px-3 py-2"
                rows={3}
              />
            </div>
          </>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="flex-1 bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
