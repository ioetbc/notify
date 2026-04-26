import { useNavigate } from 'react-router-dom';
import { formatRelativeTime } from '../../utils/format-time';
import { TransactionalRowProps } from './transactional-row.types';

export function TransactionalRow({ transactional }: TransactionalRowProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/transactional/${transactional.id}`)}
      className="grid grid-cols-[1fr_6rem_5rem_5rem_5rem_5rem] items-center h-10 px-3 hover:bg-row-hover rounded-md cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-text-secondary">📄</span>
        <span className="font-medium text-sm text-text-primary truncate">
          {transactional.name}
        </span>
      </div>
      <div className="text-sm text-text-secondary">
        {formatRelativeTime(transactional.lastSentAt)}
      </div>
      <div className="text-sm text-text-secondary text-right">
        {transactional.sends > 0 ? transactional.sends.toLocaleString() : '-'}
      </div>
      <div className="text-sm text-text-secondary text-right">
        {transactional.opens > 0 ? transactional.opens.toLocaleString() : '-'}
      </div>
      <div className="text-sm text-text-secondary text-right">
        -
      </div>
      <div className="text-sm text-text-secondary text-right capitalize">
        {transactional.status}
      </div>
    </div>
  );
}
