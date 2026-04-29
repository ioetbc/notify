import { Outlet } from 'react-router-dom';

export function Layout() {
  return (
    <div className="flex h-screen bg-white">
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
