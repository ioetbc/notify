export interface NewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export interface ModalOption {
  title: string;
  subtitle: string;
  description: string;
  path: string;
  icon: string;
}
