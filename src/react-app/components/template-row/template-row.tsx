import { useNavigate } from 'react-router-dom';
import { TemplateRowProps } from './template-row.types';

export function TemplateRow({ template }: TemplateRowProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (template.type === 'campaign') {
      navigate(`/campaigns/new?template=${template.id}`);
    } else {
      navigate(`/transactional/new?template=${template.id}`);
    }
  };

  return (
    <div
      onClick={handleClick}
      className="flex items-center h-10 px-3 hover:bg-row-hover rounded-md cursor-pointer transition-colors"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span>{template.emoji}</span>
        <span className="font-medium text-sm text-text-primary">
          {template.name}
        </span>
        <span className="text-sm text-text-secondary">
          {template.description}
        </span>
      </div>
    </div>
  );
}
