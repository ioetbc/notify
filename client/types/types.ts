export interface Campaign {
  id: string;
  name: string;
  emoji: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  lastSentAt: Date | null;
  sends: number;
  opens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transactional {
  id: string;
  name: string;
  emoji: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  lastSentAt: Date | null;
  sends: number;
  opens: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Template {
  id: string;
  name: string;
  emoji: string;
  description: string;
  type: 'campaign' | 'transactional';
}
