import { useState, useEffect } from 'react';
import { AccordionSectionProps } from './accordion-section.types';

export function AccordionSection({ title, count, storageKey, children }: AccordionSectionProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== null ? JSON.parse(stored) : true;
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(isExpanded));
  }, [storageKey, isExpanded]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center h-9 px-3">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-left hover:bg-row-hover rounded-md transition-colors cursor-pointer py-1 px-1 -ml-1"
        >
          <span
            className={`text-xs text-text-secondary transition-transform ${
              isExpanded ? 'rotate-90' : ''
            }`}
          >
            ▶
          </span>
          <span className="font-semibold text-sm text-text-primary">{title}</span>
          <span className="text-sm text-text-secondary">{count}</span>
        </button>
        <div className="ml-auto flex items-center gap-2 text-text-secondary">
          <button className="hover:text-text-primary transition-colors cursor-pointer p-1">↗</button>
          <button className="hover:text-text-primary transition-colors cursor-pointer p-1">+</button>
        </div>
      </div>
      {isExpanded && <div>{children}</div>}
    </div>
  );
}
