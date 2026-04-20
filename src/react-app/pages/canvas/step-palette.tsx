import { Clock, GitBranch, Bell, Zap } from 'lucide-react';
import type { StepType } from './types';

interface StepPaletteItemProps {
  type: StepType;
  label: string;
  icon: React.ReactNode;
  color: string;
}

function StepPaletteItem({ type, label, icon, color }: StepPaletteItemProps) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/steptype', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border-2 cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${color}`}
    >
      {icon}
      <span className="font-medium text-sm">{label}</span>
    </div>
  );
}

export function StepPalette() {
  return (
    <div className="w-48 bg-white border-r border-gray-200 p-4 flex flex-col gap-3">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Steps
      </h3>
      <StepPaletteItem
        type="trigger"
        label="Trigger"
        icon={<Zap className="w-4 h-4 text-green-600" />}
        color="bg-green-50 border-green-200 text-green-800"
      />
      <StepPaletteItem
        type="wait"
        label="Wait"
        icon={<Clock className="w-4 h-4 text-amber-600" />}
        color="bg-amber-50 border-amber-200 text-amber-800"
      />
      <StepPaletteItem
        type="branch"
        label="Branch"
        icon={<GitBranch className="w-4 h-4 text-purple-600" />}
        color="bg-purple-50 border-purple-200 text-purple-800"
      />
      <StepPaletteItem
        type="send"
        label="Send"
        icon={<Bell className="w-4 h-4 text-blue-600" />}
        color="bg-blue-50 border-blue-200 text-blue-800"
      />
    </div>
  );
}
