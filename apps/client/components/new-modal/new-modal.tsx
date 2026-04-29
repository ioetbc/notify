import { useNavigate } from 'react-router-dom';
import { ConfigModal } from '@/components/ui/config-modal';
import { Button } from '@/components/ui/button';
import { NewModalProps } from './new-modal.types';
import { options } from './new-modal.data';

export function NewModal({ isOpen, onClose }: NewModalProps) {
  const navigate = useNavigate();

  const handleOptionClick = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <ConfigModal
      open={isOpen}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Choose a starting point"
    >
      <div className="grid grid-cols-3 gap-4">
        {options.map((option) => (
          <Button
            key={option.title}
            variant="outline"
            onClick={() => handleOptionClick(option.path)}
            className="h-auto flex-col gap-2 p-6 text-center hover:border-primary hover:bg-active-nav"
          >
            <div className="flex h-12 w-12 items-center justify-center text-2xl">
              {option.icon}
            </div>
            <h3 className="font-semibold text-text-primary">{option.title}</h3>
            <p className="text-xs text-text-secondary">{option.subtitle}</p>
            <p className="text-xs text-text-secondary">{option.description}</p>
          </Button>
        ))}
      </div>
    </ConfigModal>
  );
}
