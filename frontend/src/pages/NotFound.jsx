import { useLocation, Link } from "react-router-dom";

export default function NotFound() {
  const location = useLocation();

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-xl mx-auto text-center space-y-6 py-20">
        <h1 className="text-8xl font-bold text-purple-400/60">404</h1>
        <h2 className="text-2xl font-semibold text-white">Page not found</h2>
        <p className="text-gray-400">
          <code className="text-gray-300 bg-gray-800 px-2 py-0.5 rounded text-sm">
            {location.pathname}
          </code>{" "}
          doesn&rsquo;t exist on this site.
        </p>
        <p className="text-gray-500 text-sm">
          The page may have been moved or the link might be incorrect.
        </p>
        <Link
          to="/"
          className="inline-block mt-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-6 py-2.5 rounded-md transition-colors"
        >
          Back to Matches
        </Link>
      </div>
    </div>
  );
}
