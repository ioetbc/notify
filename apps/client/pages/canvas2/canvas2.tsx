import { useState } from 'react';
import type { WorkflowTree, ConnectorLocation, StepKind, TreeNode, TriggerData } from './types';
import {
  seedTree,
  findNodeById,
  insertNodeAtPath,
  removeNodeAtPath,
  updateNodeAtPath,
  newNodeForKind,
  chainHasDownstreamExit,
} from './tree';
import { validateTree } from './validation';
import { useUserColumns2, useEventNames2, useWorkflow2, useSave2, usePublish2 } from './hooks';
import { TriggerCard } from './trigger-card';
import { Chain } from './chain';
import { StepPickerModal } from './step-picker-modal';
import { StepConfigDrawer } from './step-config-drawer';

interface Canvas2Props {
  workflowId?: string;
}

export function Canvas2({ workflowId }: Canvas2Props) {
  const [tree, setTree] = useState<WorkflowTree>(() => seedTree());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [pickerLocation, setPickerLocation] = useState<ConnectorLocation | null>(null);

  const { data: userColumns = [] } = useUserColumns2();
  const { data: eventNames = [] } = useEventNames2();

  useWorkflow2(workflowId, (loaded) => setTree(loaded));

  const saveMutation = useSave2(workflowId, tree);
  const publishMutation = usePublish2(workflowId);

  const errors = validateTree(tree);
  const canSave = errors.length === 0;
  const isActive = tree.status === 'active';

  function handleInsert(loc: ConnectorLocation) {
    setPickerLocation(loc);
  }

  function handlePick(kind: StepKind) {
    if (!pickerLocation) return;
    const node = newNodeForKind(kind);
    setTree((t) => insertNodeAtPath(t, pickerLocation, node));
    setPickerLocation(null);
  }

  function handleDelete(loc: ConnectorLocation) {
    setTree((t) => removeNodeAtPath(t, loc));
    setSelectedStepId(null);
  }

  function handleSelect(id: string) {
    setSelectedStepId(id);
  }

  function handleUpdateConfig(id: string, config: TreeNode['config']) {
    setTree((t) =>
      updateNodeAtPath(t, id, (n) => ({ ...n, config } as TreeNode))
    );
  }

  function handleTriggerChange(trigger: TriggerData) {
    setTree((t) => ({ ...t, trigger }));
  }

  const selectedNode = selectedStepId ? findNodeById(tree, selectedStepId) : null;
  const hideExit = pickerLocation ? chainHasDownstreamExit(tree, pickerLocation) : false;

  return (
    <div className="min-h-full bg-slate-50">
      {/* Toolbar */}
      <div className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between sticky top-0 z-30">
        <input
          type="text"
          placeholder="Workflow name"
          className="text-lg font-semibold border-none outline-none bg-transparent"
          value={tree.name}
          onChange={(e) => setTree((t) => ({ ...t, name: e.target.value }))}
        />
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
              isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
            }`}
          >
            {isActive ? 'Active' : 'Draft'}
          </span>
          {errors.length > 0 && (
            <span
              className="text-xs text-red-600 max-w-[300px] truncate"
              title={errors.join('\n')}
            >
              {errors[0]}
            </span>
          )}
          <button
            onClick={() => saveMutation.mutate()}
            disabled={!canSave || saveMutation.isPending}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          {workflowId && !isActive && (
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {publishMutation.isPending ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
      </div>

      {/* Page body */}
      <div className="max-w-[640px] mx-auto py-12 px-6">
        <TriggerCard
          trigger={tree.trigger}
          eventNames={eventNames}
          onChange={handleTriggerChange}
        />
        <Chain
          chain={tree.root}
          chainPath={[]}
          selectedStepId={selectedStepId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onInsert={handleInsert}
        />
      </div>

      <StepPickerModal
        open={pickerLocation !== null}
        location={pickerLocation}
        onClose={() => setPickerLocation(null)}
        onPick={handlePick}
        hideExit={hideExit}
      />

      <StepConfigDrawer
        node={selectedNode}
        userColumns={userColumns}
        onClose={() => setSelectedStepId(null)}
        onUpdate={handleUpdateConfig}
      />
    </div>
  );
}
