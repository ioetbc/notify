import { Campaign, Transactional, Template } from '../../types';

export const campaigns: Campaign[] = [
  {
    id: 'camp_1',
    name: 'Welcome Series',
    emoji: '👋',
    status: 'active',
    lastSentAt: new Date('2024-03-29T10:00:00Z'),
    sends: 1234,
    opens: 567,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-03-29T10:00:00Z'),
  },
  {
    id: 'camp_2',
    name: 'Product Launch Announcement',
    emoji: '🚀',
    status: 'draft',
    lastSentAt: null,
    sends: 0,
    opens: 0,
    createdAt: new Date('2024-03-15T00:00:00Z'),
    updatedAt: new Date('2024-03-15T00:00:00Z'),
  },
  {
    id: 'camp_3',
    name: 'Summer Sale Promotion',
    emoji: '☀️',
    status: 'paused',
    lastSentAt: new Date('2024-03-15T14:30:00Z'),
    sends: 8901,
    opens: 2345,
    createdAt: new Date('2024-02-01T00:00:00Z'),
    updatedAt: new Date('2024-03-15T14:30:00Z'),
  },
];

export const transactional: Transactional[] = [
  {
    id: 'trans_1',
    name: 'Password Reset',
    emoji: '🔑',
    status: 'active',
    lastSentAt: new Date('2024-03-31T09:15:00Z'),
    sends: 456,
    opens: 234,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-03-31T09:15:00Z'),
  },
  {
    id: 'trans_2',
    name: 'Order Confirmation',
    emoji: '📦',
    status: 'active',
    lastSentAt: new Date('2024-03-30T16:45:00Z'),
    sends: 2341,
    opens: 1890,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-03-30T16:45:00Z'),
  },
];

export const campaignTemplates: Template[] = [
  {
    id: 'ct_1',
    name: 'Blank campaign',
    emoji: '✏️',
    description: 'Create a new campaign from scratch',
    type: 'campaign',
  },
  {
    id: 'ct_2',
    name: 'New feature announcement',
    emoji: '📣',
    description: 'Announce a new key feature to your users',
    type: 'campaign',
  },
  {
    id: 'ct_3',
    name: 'Product update',
    emoji: '📦',
    description: 'Announce your latest product update',
    type: 'campaign',
  },
  {
    id: 'ct_4',
    name: 'Survey request',
    emoji: '📋',
    description: 'Ask users for feedback with a survey',
    type: 'campaign',
  },
];

export const transactionalTemplates: Template[] = [
  {
    id: 'tt_1',
    name: 'Blank transactional',
    emoji: '✏️',
    description: 'Start from scratch',
    type: 'transactional',
  },
  {
    id: 'tt_2',
    name: 'Password reset',
    emoji: '🔐',
    description: 'Send users a link to reset their password',
    type: 'transactional',
  },
  {
    id: 'tt_3',
    name: 'Account verification',
    emoji: '✅',
    description: 'Verify a user\'s email address',
    type: 'transactional',
  },
];
