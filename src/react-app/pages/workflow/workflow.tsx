import { useEffect, useState } from 'react';

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

interface Step {
  id: string;
  step_type: 'wait' | 'branch' | 'send';
  step_order: number;
  wait_hours?: number;
  branch_user_column?: string;
  branch_operator?: string;
  branch_compare_value?: string;
  send_title?: string;
  send_body?: string;
}

interface Workflow {
  id: string;
  name: string;
  trigger_event: string;
  active: boolean;
}

interface WorkflowData {
  workflow: Workflow;
  steps: Step[];
}

interface Enums {
  trigger_event: string[];
  step_type: string[];
  branch_operator: string[];
}

interface EditingState {
  type: 'trigger' | 'step';
  stepId?: string;
  stepType?: string;
}

function getStepLabel(step: Step): string {
  switch (step.step_type) {
    case 'wait':
      return `Wait ${step.wait_hours}h`;
    case 'branch':
      return `If ${step.branch_user_column} ${step.branch_operator} "${step.branch_compare_value}"`;
    case 'send':
      return `Send: "${step.send_title}"`;
    default:
      return step.step_type;
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
  const [data, setData] = useState<WorkflowData | null>(null);
  const [enums, setEnums] = useState<Enums | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchData() {
      if (!API_URL) {
        setError('API URL not configured');
        setLoading(false);
        return;
      }

      try {
        // Fetch enums and workflows in parallel
        const [enumsRes, listRes] = await Promise.all([
          fetch(`${API_URL}/enums`),
          fetch(`${API_URL}/workflows`),
        ]);

        const enumsData = await enumsRes.json();
        setEnums(enumsData);

        const listData = await listRes.json();
        if (!listData.workflows?.[0]) {
          setError('No workflows found. Run db:seed first.');
          setLoading(false);
          return;
        }

        const workflowId = listData.workflows[0].id;
        const res = await fetch(`${API_URL}/workflows/${workflowId}`);
        const result = await res.json();
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  async function updateTriggerEvent(value: string) {
    if (!data) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/workflows/${data.workflow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger_event: value }),
      });
      setData({
        ...data,
        workflow: { ...data.workflow, trigger_event: value },
      });
      setEditing(null);
    } catch (err) {
      console.error('Failed to update:', err);
    } finally {
      setSaving(false);
    }
  }

  async function updateStep(stepId: string, updates: Record<string, unknown>) {
    if (!data) return;
    setSaving(true);
    try {
      await fetch(`${API_URL}/steps/${stepId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      // Refetch the workflow to get updated data
      const res = await fetch(`${API_URL}/workflows/${data.workflow.id}`);
      const result = await res.json();
      setData(result);
      setEditing(null);
    } catch (err) {
      console.error('Failed to update:', err);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading...</div>;
  if (error) return <div className="p-6 text-red-500">{error}</div>;
  if (!data) return <div className="p-6">No data</div>;

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-6">{data.workflow.name}</h1>

      <div className="flex items-center gap-3 flex-wrap">
        {/* Trigger */}
        <div className="relative group">
          <div className="px-4 py-2 bg-green-100 border border-green-300 rounded-lg font-medium flex items-center gap-2">
            <span>{data.workflow.trigger_event}</span>
            <button
              onClick={() => setEditing({ type: 'trigger' })}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-green-200 rounded"
              title="Edit trigger"
            >
              <PencilIcon />
            </button>
          </div>

          {editing?.type === 'trigger' && enums && (
            <EditDropdown
              options={enums.trigger_event}
              currentValue={data.workflow.trigger_event}
              onSelect={updateTriggerEvent}
              onClose={() => setEditing(null)}
              saving={saving}
            />
          )}
        </div>

        {/* Steps */}
        {data.steps.map((step) => (
          <div key={step.id} className="flex items-center gap-3">
            <span className="text-gray-400 text-xl">→</span>
            <div className="relative group">
              <div className="px-4 py-2 bg-blue-100 border border-blue-300 rounded-lg flex items-center gap-2">
                <span>{getStepLabel(step)}</span>
                <button
                  onClick={() =>
                    setEditing({
                      type: 'step',
                      stepId: step.id,
                      stepType: step.step_type,
                    })
                  }
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-blue-200 rounded"
                  title="Edit step"
                >
                  <PencilIcon />
                </button>
              </div>

              {editing?.type === 'step' &&
                editing.stepId === step.id &&
                enums && (
                  <StepEditPopover
                    step={step}
                    enums={enums}
                    onUpdate={(updates) => updateStep(step.id, updates)}
                    onClose={() => setEditing(null)}
                    saving={saving}
                  />
                )}
            </div>
          </div>
        ))}

        <span className="text-gray-400 text-xl">→</span>
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
  enums,
  onUpdate,
  onClose,
  saving,
}: {
  step: Step;
  enums: Enums;
  onUpdate: (updates: Record<string, unknown>) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [formData, setFormData] = useState(() => {
    if (step.step_type === 'wait') {
      return { hours: step.wait_hours?.toString() || '' };
    }
    if (step.step_type === 'branch') {
      return {
        user_column: step.branch_user_column || '',
        operator: step.branch_operator || '',
        compare_value: step.branch_compare_value || '',
      };
    }
    if (step.step_type === 'send') {
      return {
        title: step.send_title || '',
        body: step.send_body || '',
      };
    }
    return {};
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (step.step_type === 'wait') {
      onUpdate({ hours: parseInt(formData.hours as string, 10) });
    } else {
      onUpdate(formData);
    }
  }

  return (
    <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[280px]">
      <form onSubmit={handleSubmit} className="p-3">
        <div className="text-xs text-gray-500 mb-3 font-medium">
          Edit {step.step_type} step
        </div>

        {step.step_type === 'wait' && (
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

        {step.step_type === 'branch' && (
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
                {enums.branch_operator.map((op) => (
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

        {step.step_type === 'send' && (
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
