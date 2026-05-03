import { useState } from 'react';
import { Button } from '../ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import type { IntegrationSummary } from '../../lib/api/integrations';

export type ConnectedStateProps = {
  integration: IntegrationSummary;
  disconnecting: boolean;
  onDisconnect: () => void;
  onManageEvents: () => void;
};

export function ConnectedState({
  integration,
  disconnecting,
  onDisconnect,
  onManageEvents,
}: ConnectedStateProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-gray-500">Project ID</dt>
        <dd className="font-mono text-gray-900">{integration.project_id}</dd>
        <dt className="text-gray-500">Last connected</dt>
        <dd className="text-gray-900">{relativeTime(integration.connected_at)}</dd>
      </dl>

      <div className="flex gap-2">
        <Button variant="outline" onClick={onManageEvents}>
          Manage events
        </Button>
        <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
          Disconnect
        </Button>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect PostHog?</DialogTitle>
            <DialogDescription>
              Workflows triggered by PostHog events will stop firing. The hog function in your
              PostHog project will not be deleted automatically — you can remove it from PostHog
              if you want to clean up.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={disconnecting}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onDisconnect();
              }}
              disabled={disconnecting}
            >
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  return `${Math.round(diffSec / 86400)}d ago`;
}
