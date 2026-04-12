import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NewModalProps } from './new-modal.types';
import { options } from './new-modal.data';

export function NewModal({ isOpen, onClose }: NewModalProps) {
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleOptionClick = (path: string) => {
    onClose();
    navigate(path);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 cursor-pointer"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-2xl w-full flex flex-col gap-6 p-6 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-text-primary">
            Choose a starting point
          </h2>
          <button
            onClick={onClose}
            className="text-text-secondary hover:text-text-primary transition-colors text-xl cursor-pointer"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {options.map((option) => (
            <button
              key={option.title}
              onClick={() => handleOptionClick(option.path)}
              className="flex flex-col items-center gap-2 p-6 border border-border rounded-lg hover:border-primary hover:bg-active-nav transition-colors text-center cursor-pointer"
            >
              <div className="w-12 h-12 flex items-center justify-center text-2xl">
                {option.icon}
              </div>
              <h3 className="font-semibold text-text-primary">
                {option.title}
              </h3>
              <p className="text-xs text-text-secondary">{option.subtitle}</p>
              <p className="text-xs text-text-secondary">{option.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
