/**
 * LoadingSkeleton — animated placeholder for async content.
 *
 * Variants:
 *   card       – Grid of card shapes (TeamsList, HeroesList)
 *   table-row  – Table header + body rows (MatchList)
 *   detail     – Large header + content blocks (MatchDetail, PlayerDetail, HeroDetail)
 *   list-item  – Single-column list items (PlayersList, ItemsList)
 *   text       – Simple centered text block (SeriesDetail, Community)
 *
 * Props:
 *   variant   – one of "card" | "table-row" | "detail" | "list-item" | "text"
 *   count     – number of skeleton items to render (default varies by variant)
 *   className – additional wrapper classes
 */
export default function LoadingSkeleton({
  variant = "text",
  count,
  className = "",
}) {
  const defaults = { card: 8, "table-row": 5, detail: 1, "list-item": 6, text: 1 };
  const n = count ?? defaults[variant] ?? 1;

  const pulse = "animate-pulse bg-gray-700/50 rounded";

  /* ── card ── */
  if (variant === "card") {
    return (
      <div className={`w-full px-4 py-8 ${className}`}>
        {/* Title + subtitle */}
        <div className="mb-6">
          <div className={`${pulse} h-8 w-36 mb-2`} />
          <div className={`${pulse} h-4 w-24`} />
        </div>
        {/* Search bar placeholder */}
        <div className={`${pulse} h-10 w-80 mb-8`} />
        {/* Card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: n }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl border border-gray-700 bg-gray-800/50 p-5 space-y-3"
            >
              <div className={`${pulse} h-5 w-3/4`} />
              <div className={`${pulse} h-3 w-1/2`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── table-row ── */
  if (variant === "table-row") {
    return (
      <div className={`w-full px-4 py-8 ${className}`}>
        {/* Filter bar placeholder */}
        <div className="flex flex-wrap gap-3 mb-6">
          <div className={`${pulse} h-10 w-48`} />
          <div className={`${pulse} h-10 w-48`} />
          <div className={`${pulse} h-10 w-36`} />
        </div>
        {/* Table */}
        <div className="bg-table border border-border-light shadow rounded-lg p-6">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-light">
                {Array.from({ length: 5 }).map((_, i) => (
                  <th key={i} className="p-4">
                    <div className={`${pulse} h-4 w-16 mx-auto`} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }).map((_, row) => (
                <tr key={row} className="border-b border-gray-700/30">
                  {Array.from({ length: 5 }).map((_, col) => (
                    <td key={col} className="p-4">
                      <div
                        className={`${pulse} h-4 ${col === 2 ? "w-3/4" : col === 3 ? "w-1/3" : "w-1/2"}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  /* ── detail ── */
  if (variant === "detail") {
    return (
      <div className={`w-full px-4 py-8 ${className}`}>
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Hero area */}
          <div className="flex items-center gap-4 mb-6">
            <div className={`${pulse} h-16 w-16 rounded-full shrink-0`} />
            <div className="space-y-2 flex-1">
              <div className={`${pulse} h-8 w-48`} />
              <div className={`${pulse} h-4 w-32`} />
            </div>
          </div>
          {/* Stat cards row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 space-y-2">
                <div className={`${pulse} h-3 w-16`} />
                <div className={`${pulse} h-6 w-12`} />
              </div>
            ))}
          </div>
          {/* Content blocks */}
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="bg-gray-800/50 border border-gray-700 rounded-xl p-6 space-y-3">
              <div className={`${pulse} h-5 w-32`} />
              <div className={`${pulse} h-3 w-full`} />
              <div className={`${pulse} h-3 w-5/6`} />
              <div className={`${pulse} h-3 w-2/3`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── list-item ── */
  if (variant === "list-item") {
    return (
      <div className={`w-full px-4 py-8 ${className}`}>
        {/* Search bar */}
        <div className={`${pulse} h-10 w-80 mb-6`} />
        {/* List items */}
        <div className="space-y-3">
          {Array.from({ length: n }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/30">
              <div className={`${pulse} h-10 w-10 rounded-full shrink-0`} />
              <div className="flex-1 space-y-1.5">
                <div className={`${pulse} h-4 w-2/5`} />
                <div className={`${pulse} h-3 w-1/4`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ── text (default fallback) ── */
  return (
    <div className={`w-full p-8 ${className}`}>
      <div className="max-w-3xl mx-auto space-y-4">
        {Array.from({ length: n }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className={`${pulse} h-6 w-48 mx-auto`} />
            <div className={`${pulse} h-3 w-3/4 mx-auto`} />
          </div>
        ))}
      </div>
    </div>
  );
}
