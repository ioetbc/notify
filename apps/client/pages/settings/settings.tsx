import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { client, queryClient } from '../../lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface PreviewEvent {
  name: string;
  last_seen_at: string | null;
}

type Stage = 'credentials' | 'events';

export function Settings() {
  const [stage, setStage] = useState<Stage>('credentials');
  const [pat, setPat] = useState('');
  const [teamId, setTeamId] = useState('');
  const [identityField, setIdentityField] = useState('distinct_id');
  const [previewEvents, setPreviewEvents] = useState<PreviewEvent[]>([]);
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);

  const integrationQuery = useQuery({
    queryKey: ['posthog-integration'],
    queryFn: async () => {
      const res = await client.integrations.posthog.$get();
      return res.json();
    },
  });

  const previewMutation = useMutation({
    mutationFn: async () => {
      const res = await client.integrations.posthog.preview.$post({
        json: { pat, team_id: teamId },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error('error' in data ? data.error.message : 'Preview failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      if ('event_definitions' in data) {
        setPreviewEvents(data.event_definitions as PreviewEvent[]);
        setStage('events');
        setError(null);
      }
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to validate credentials');
    },
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await client.integrations.posthog.$post({
        json: {
          pat,
          team_id: teamId,
          identity_field: identityField,
          enabled_events: Array.from(selectedEvents),
        },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error('error' in data ? data.error.message : 'Connect failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['posthog-integration'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await client.integrations.posthog.$delete();
      if (!res.ok) {
        const data = await res.json();
        throw new Error('error' in data ? data.error.message : 'Disconnect failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['posthog-integration'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    },
  });

  const purgeMutation = useMutation({
    mutationFn: async () => {
      const res = await client.integrations.posthog.data.$delete();
      if (!res.ok) {
        const data = await res.json();
        throw new Error('error' in data ? data.error.message : 'Purge failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setPurgeDialogOpen(false);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['posthog-integration'] });
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to purge data');
    },
  });

  function toggleEvent(name: string) {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  const isConnected =
    integrationQuery.data && 'connected' in integrationQuery.data && integrationQuery.data.connected;

  if (integrationQuery.isLoading) {
    return (
      <div className="p-6">
        <h1 className="text-base font-semibold mb-4">Settings</h1>
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  if (isConnected && 'integration' in integrationQuery.data!) {
    const integration = integrationQuery.data!.integration;
    return (
      <div className="p-6 max-w-xl">
        <h1 className="text-base font-semibold mb-4">Settings</h1>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded mb-4">{error}</p>
        )}

        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium">PostHog Integration</h2>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
              Connected
            </span>
          </div>
          <div className="text-sm space-y-1">
            <p><span className="text-gray-500">PAT:</span> {integration.masked_pat}</p>
            <p><span className="text-gray-500">Team ID:</span> {integration.team_id}</p>
            <p><span className="text-gray-500">Identity field:</span> {integration.identity_field}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500 mb-1">Enabled events:</p>
            <ul className="text-sm space-y-0.5">
              {integration.event_definitions
                .filter((d: { enabled_as_trigger: boolean }) => d.enabled_as_trigger)
                .map((d: { id: string; name: string }) => (
                  <li key={d.id} className="pl-2">{d.name}</li>
                ))}
            </ul>
          </div>
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="outline"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setPurgeDialogOpen(true)}
            >
              Purge PostHog Data
            </Button>
          </div>
        </div>

        <Dialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Purge PostHog Data</DialogTitle>
              <DialogDescription>
                This will permanently delete all PostHog events and event definitions for
                your account. Workflows using PostHog triggers will lose their trigger
                configuration. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPurgeDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => purgeMutation.mutate()}
                disabled={purgeMutation.isPending}
              >
                {purgeMutation.isPending ? 'Purging...' : 'Yes, purge all data'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-base font-semibold mb-4">Settings</h1>
      <div className="border rounded-lg p-4 space-y-4">
        <h2 className="font-medium">Connect PostHog</h2>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>
        )}

        {stage === 'credentials' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Personal Access Token</Label>
              <Input
                type="password"
                value={pat}
                onChange={(e) => setPat(e.target.value)}
                placeholder="phx_..."
              />
            </div>
            <div className="space-y-1">
              <Label>Team ID</Label>
              <Input
                type="text"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="12345"
              />
            </div>
            <div className="space-y-1">
              <Label>Identity Field</Label>
              <Input
                type="text"
                value={identityField}
                onChange={(e) => setIdentityField(e.target.value)}
                placeholder="distinct_id"
              />
              <p className="text-xs text-gray-500">
                PostHog property used to match users. Defaults to distinct_id.
              </p>
            </div>
            <Button
              onClick={() => previewMutation.mutate()}
              disabled={!pat || !teamId || previewMutation.isPending}
            >
              {previewMutation.isPending ? 'Validating...' : 'Load Events'}
            </Button>
          </div>
        )}

        {stage === 'events' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Select the events you want available as workflow triggers:
            </p>
            <div className="max-h-64 overflow-y-auto border rounded divide-y">
              {previewEvents.map((evt) => (
                <label
                  key={evt.name}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedEvents.has(evt.name)}
                    onChange={() => toggleEvent(evt.name)}
                    className="rounded"
                  />
                  <span className="text-sm">{evt.name}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setStage('credentials')}
              >
                Back
              </Button>
              <Button
                onClick={() => connectMutation.mutate()}
                disabled={selectedEvents.size === 0 || connectMutation.isPending}
              >
                {connectMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
