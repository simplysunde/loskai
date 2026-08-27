import { Compass } from "lucide-react";
import { Link, useLocation } from "react-router-dom";

// Rendered inside <Layout/> for any unmatched path, so the sidebar stays and the pane
// explains itself. The backend's SPA catch-all already serves index.html for unknown
// paths — without this route that landed on Layout chrome around an empty pane.
export function NotFound() {
  const { pathname } = useLocation();

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <Compass className="mx-auto h-10 w-10 text-slate-600" />
      <h1 className="mt-4 text-2xl font-semibold text-slate-100">Page not found</h1>
      <p className="mt-2 text-sm text-slate-500">
        Nothing is routed at <span className="font-mono text-slate-400">{pathname}</span>.
      </p>
      <Link
        to="/"
        className="mt-6 inline-block rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
      >
        Back to Dashboard
      </Link>
    </div>
  );
}
