import { EmptyStateProps } from './empty-state.types';

export function EmptyState({ message, onCreateClick }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 px-3 py-4">
      <p className="text-sm text-text-secondary">{message}</p>
      <button
        onClick={onCreateClick}
        className="text-sm text-primary hover:text-primary-hover transition-colors cursor-pointer"
      >
        Create your first one →
      </button>
    </div>
  );
}
