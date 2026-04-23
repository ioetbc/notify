import { ModalOption } from './new-modal.types';

export const options: ModalOption[] = [
  {
    title: 'Campaign',
    subtitle: 'Sent once manually',
    description: 'Updates, announcements, surveys, and promotions',
    path: '/campaigns/new',
    icon: '📧',
  },
  {
    title: 'Loop',
    subtitle: 'Triggered by an event',
    description: 'Onboarding, retention, reengagement, and churn',
    path: '/loops/new',
    icon: '🔄',
  },
  {
    title: 'Transactional',
    subtitle: 'Sent once automatically',
    description: 'Password reset, receipts, and order confirmation',
    path: '/transactional/new',
    icon: '⚡',
  },
];
