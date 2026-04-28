import { Plus } from 'lucide-react';
import type { ConnectorLocation } from './types';

interface ConnectorProps {
  location: ConnectorLocation;
  onInsert: (loc: ConnectorLocation) => void;
}

export function Connector({ location, onInsert }: ConnectorProps) {
  return (
    <div className="relative w-px h-8 bg-slate-300 mx-auto group">
      <button
        type="button"
        onClick={() => onInsert(location)}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border border-slate-300 text-slate-500 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600 transition"
        aria-label="Insert step"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
