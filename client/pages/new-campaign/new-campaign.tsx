import { useSearchParams, Link } from 'react-router-dom';

export function NewCampaign() {
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('template');

  return (
    <div className="flex flex-col gap-4 p-6">
      <Link to="/" className="text-sm text-primary hover:text-primary-hover">
        ← Back to Home
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text-primary">
          New Campaign
        </h1>
        {templateId && (
          <p className="text-text-secondary">
            Using template: {templateId}
          </p>
        )}
        <p className="text-text-secondary">
          New campaign page placeholder
        </p>
      </div>
    </div>
  );
}
