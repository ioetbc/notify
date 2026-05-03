import { useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

const HELP_URL = 'https://us.posthog.com/settings/user-api-keys';

export type ConnectFormProps = {
  submitting: boolean;
  authError: boolean;
  onSubmit: (input: {
    personal_api_key: string;
    project_id: string;
    region: 'us' | 'eu';
  }) => void;
};

export function ConnectForm({ submitting, authError, onSubmit }: ConnectFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [projectId, setProjectId] = useState('');
  const [region, setRegion] = useState<'us' | 'eu'>('eu');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!apiKey || !projectId) return;
    onSubmit({ personal_api_key: apiKey, project_id: projectId, region });
  };

  return (
    <form onSubmit={handleSubmit} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="posthog-api-key">PostHog personal API key</Label>
        <p className="text-xs text-gray-500">
          The key needs the <code className="font-mono text-gray-700">hog_function:write</code> and the <code className="font-mono text-gray-700">query:read</code> scope so
          Notify can provision the inbound webhook on your behalf. Project API keys won't work — PostHog
          only exposes that scope on personal API keys.
        </p>
        <Input
          id="posthog-api-key"
          type="password"
          autoComplete="off"
          placeholder="phx_…"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          aria-invalid={authError || undefined}
          disabled={submitting}
        />
        {authError && (
          <p className="text-sm text-red-600">
            PostHog rejected that key. Double-check the value and the project ID, then try again.
          </p>
        )}
        <a href={HELP_URL} className="text-xs text-gray-500 underline">
          How do I create a personal API key in PostHog?
        </a>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="posthog-project-id">PostHog project ID</Label>
        <Input
          id="posthog-project-id"
          inputMode="numeric"
          placeholder="12345"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="posthog-region">PostHog region</Label>
        <p className="text-xs text-gray-500">
          Pick the region your PostHog project is hosted in. Check your dashboard URL —{' '}
          <code className="font-mono text-gray-700">us.posthog.com</code> or{' '}
          <code className="font-mono text-gray-700">eu.posthog.com</code>.
        </p>
        <select
          id="posthog-region"
          value={region}
          onChange={(e) => setRegion(e.target.value as 'us' | 'eu')}
          disabled={submitting}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="us">US (us.posthog.com)</option>
          <option value="eu">EU (eu.posthog.com)</option>
        </select>
      </div>

      <div>
        <Button type="submit" disabled={submitting || !apiKey || !projectId}>
          {submitting ? 'Connecting…' : 'Connect PostHog'}
        </Button>
      </div>
    </form>
  );
}
