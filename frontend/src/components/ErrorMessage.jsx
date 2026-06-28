/**
 * ErrorMessage — inline error banner for failed API fetches.
 *
 * Props:
 *   message  – the error message to display
 *   onRetry  – optional callback for a "Retry" button
 *   variant  – "error" (red, default) or "warning" (amber, for non-critical failures)
 *   className – additional wrapper classes
 */
export default function ErrorMessage({
  message,
  onRetry,
  variant = "error",
  className = "",
}) {
  const isError = variant === "error";

  return (
    <div
      className={`w-full px-4 py-8 ${className}`}
    >
      <div
        className={`max-w-3xl mx-auto rounded-lg border p-6 text-center ${
          isError
            ? "bg-red-900/20 border-red-500/40"
            : "bg-amber-900/20 border-amber-500/40"
        }`}
      >
        <p
          className={`font-semibold ${
            isError ? "text-red-400" : "text-amber-400"
          }`}
        >
          {isError ? "Something went wrong" : "Something may be off"}
        </p>
        <p
          className={`text-sm mt-1 ${
            isError ? "text-red-300/70" : "text-amber-300/70"
          }`}
        >
          {message}
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className={`mt-4 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              isError
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-amber-600 hover:bg-amber-500 text-white"
            }`}
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
