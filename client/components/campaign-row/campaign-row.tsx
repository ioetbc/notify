import { useNavigate } from 'react-router-dom';
import { formatRelativeTime } from '../../utils/format-time';
import { CampaignRowProps } from './campaign-row.types';

export function CampaignRow({ campaign }: CampaignRowProps) {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/campaigns/${campaign.id}`)}
      className="grid grid-cols-[1fr_6rem_5rem_5rem_5rem_5rem] items-center h-10 px-3 hover:bg-row-hover rounded-md cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-text-secondary">📄</span>
        <span className="font-medium text-sm text-text-primary truncate">
          {campaign.name}
        </span>
      </div>
      <div className="text-sm text-text-secondary">
        {formatRelativeTime(campaign.lastSentAt)}
      </div>
      <div className="text-sm text-text-secondary text-right">
        {campaign.sends > 0 ? campaign.sends.toLocaleString() : '-'}
      </div>
      <div className="text-sm text-text-secondary text-right">
        {campaign.opens > 0 ? campaign.opens.toLocaleString() : '-'}
      </div>
      <div className="text-sm text-text-secondary text-right">
        -
      </div>
      <div className="text-sm text-text-secondary text-right capitalize">
        {campaign.status}
      </div>
    </div>
  );
}
