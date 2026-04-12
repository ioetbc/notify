import { ReactNode } from 'react';

export interface AccordionSectionProps {
  title: string;
  count: number;
  storageKey: string;
  children: ReactNode;
}
