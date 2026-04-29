import type { LucideIcon } from 'lucide-react';
import type { StepType } from './types';
import { variantConfig } from './nodes';

type PaletteGroup = {
  label: string;
  items: StepType[];
};

const groups: PaletteGroup[] = [
  { label: 'Triggers', items: ['trigger'] },
  { label: 'Actions', items: ['send', 'wait'] },
  { label: 'Logic', items: ['branch', 'filter'] },
  { label: 'End', items: ['exit'] },
];

function StepPaletteItem({
  type,
  icon: Icon,
  label,
  iconBg,
  iconColor,
}: {
  type: StepType;
  icon: LucideIcon;
  label: string;
  iconBg: string;
  iconColor: string;
}) {
  const onDragStart = (event: React.DragEvent) => {
    event.dataTransfer.setData('application/steptype', type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="flex items-center gap-3 px-2 py-1.5 rounded-lg cursor-grab active:cursor-grabbing hover:bg-gray-50 transition-colors"
    >
      <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${iconBg}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <span className="text-sm font-medium text-gray-900">{label}</span>
    </div>
  );
}

export function StepPalette() {
  return (
    <div className="absolute top-4 left-4 z-10">
      <div className="w-56 shadow-sm bg-white backdrop-blur-md border border-white/40 rounded-2xl p-3 flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-gray-400 px-2 mb-1">{group.label}</h3>
            {group.items.map((type) => {
              const variant = variantConfig[type];
              return (
                <StepPaletteItem
                  key={type}
                  type={type}
                  icon={variant.icon}
                  label={variant.label}
                  iconBg={variant.iconBg}
                  iconColor={variant.iconColor}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
