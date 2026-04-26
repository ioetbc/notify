import {
  Home,
  Folder,
  PenSquare,
  RefreshCw,
  Code,
  Users,
  FileText,
} from 'lucide-react';
import { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  iconSize?: number;
}

const ICON_SIZE = 16;

export const navItems: NavItem[] = [
  { to: '/', label: 'Home', icon: Home, iconSize: ICON_SIZE },
  { to: '/templates', label: 'Templates', icon: Folder, iconSize: ICON_SIZE },
  { to: '/campaigns', label: 'Campaigns', icon: PenSquare, iconSize: ICON_SIZE },
  { to: '/loops', label: 'Loops', icon: RefreshCw, iconSize: ICON_SIZE },
  { to: '/transactional', label: 'Transactional', icon: Code, iconSize: ICON_SIZE },
  { to: '/audience', label: 'Audience', icon: Users, iconSize: ICON_SIZE },
  { to: '/forms', label: 'Forms', icon: FileText, iconSize: ICON_SIZE },
];

export interface Workspace {
  id: string;
  name: string;
  initial: string;
  color: string;
}

export const currentWorkspace: Workspace = {
  id: 'ws_1',
  name: 'NoNotes',
  initial: 'N',
  color: '#84cc16', // lime-500
};

export type ThemeMode = 'system' | 'dark' | 'light';
