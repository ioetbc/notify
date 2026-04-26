import { Link } from 'react-router-dom';

export function NewLoop() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <Link to="/" className="text-sm text-primary hover:text-primary-hover">
        ← Back to Home
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-text-primary">
          New Loop
        </h1>
        <p className="text-text-secondary">
          New loop page placeholder
        </p>
      </div>
    </div>
  );
}
