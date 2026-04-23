import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, ChevronDown, Settings, Monitor, Moon, Sun, Gem } from 'lucide-react';
import { navItems, currentWorkspace, ThemeMode } from './sidebar.data';

export function Sidebar() {
  const [theme, setTheme] = useState<ThemeMode>('system');

  return (
    <aside className="w-60 h-screen bg-sidebar border-r border-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <button className="flex items-center gap-2 hover:bg-row-hover rounded-md px-2 py-1.5 transition-colors cursor-pointer">
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-white text-sm font-semibold"
            style={{ backgroundColor: currentWorkspace.color }}
          >
            {currentWorkspace.initial}
          </div>
          <span className="font-medium text-sm text-text-primary">
            {currentWorkspace.name}
          </span>
          <ChevronDown className="w-4 h-4 text-text-secondary" />
        </button>
        <button className="p-2 hover:bg-row-hover rounded-md transition-colors cursor-pointer">
          <Search className="w-4 h-4 text-text-secondary" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-gray-100 text-text-primary font-medium'
                    : 'text-text-primary hover:bg-gray-100'
                }`
              }
            >
              <Icon size={item.iconSize} />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border">
        {/* Plan indicator */}
        <div className="px-3 py-3">
          <button className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors cursor-pointer">
            <Gem className="w-5 h-5" />
            <span>Free</span>
          </button>
        </div>

        {/* Settings and theme */}
        <div className="flex items-center justify-between px-3 py-3 border-t border-border">
          <button className="p-2 hover:bg-row-hover rounded-md transition-colors cursor-pointer">
            <Settings className="w-5 h-5 text-text-secondary" />
          </button>

          <div className="flex items-center gap-1 bg-row-hover rounded-md p-1">
            <button
              onClick={() => setTheme('system')}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                theme === 'system'
                  ? 'bg-white shadow-sm text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Monitor className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTheme('dark')}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                theme === 'dark'
                  ? 'bg-white shadow-sm text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Moon className="w-4 h-4" />
            </button>
            <button
              onClick={() => setTheme('light')}
              className={`p-1.5 rounded transition-colors cursor-pointer ${
                theme === 'light'
                  ? 'bg-white shadow-sm text-text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              <Sun className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
