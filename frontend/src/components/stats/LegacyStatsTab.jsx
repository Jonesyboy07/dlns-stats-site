import React from "react";
import ErrorMessage from "../ErrorMessage";
import usePanelData from "../player/usePanelData";

/**
 * The previous stats page's hero table, kept under the Heroes tab until that tab
 * is redesigned. It reads the older endpoint, which only filters by event, so it
 * covers every Night Shift week whatever the Period and Region filters say; the
 * note at the top says so.
 */

const EVENT_QUERY = `?event_title=${encodeURIComponent("Night Shift")}`;

const heroNameFrom = (heroes, id) => (id ? heroes?.[id]?.name || heroes?.[id] || `Hero ${id}` : null);

function HeroSelection({ heroes }) {
  const { data, loading, error, reload } = usePanelData(`/db/stats/hero-selection${EVENT_QUERY}`);
  if (error) return <ErrorMessage message={error} onRetry={reload} />;
  if (loading) return <p className="text-sm text-dim">Loading…</p>;
  const rows = data?.heroes ?? [];
  if (!rows.length) return <p className="text-sm text-dim">No hero selection data available.</p>;

  return (
    <div className="rounded-xl border border-border-light bg-card p-6 text-secondary">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-2">
          <thead>
            <tr className="text-xs uppercase tracking-widest text-dim">
              <th className="pb-2 text-left font-semibold">Hero</th>
              <th className="hidden pb-2 text-left font-semibold sm:table-cell">Picks</th>
              <th className="hidden pb-2 text-left font-semibold sm:table-cell">Win Rate</th>
              <th className="pb-2 text-left font-semibold">Popularity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((hero) => {
              const popularity = Number(hero.pick_percentage || 0) * 100;
              const winRate = Number(hero.win_rate || 0) * 100;
              return (
                <tr key={hero.hero_id} className="align-middle">
                  <td className="py-2 pr-4">
                    <div className="font-semibold text-primary">{heroNameFrom(heroes, hero.hero_id)}</div>
                    <div className="mt-1 text-xs text-dim sm:hidden">
                      {hero.pick_count} picks • {winRate.toFixed(1)}% wins
                    </div>
                  </td>
                  <td className="hidden py-2 pr-4 sm:table-cell">
                    <span className="inline-flex min-w-14 justify-center rounded-full border border-border-light bg-badge-bg px-3 py-1 text-xs font-semibold text-secondary">
                      {hero.pick_count}
                    </span>
                  </td>
                  <td className="hidden py-2 pr-4 sm:table-cell">
                    <span
                      className={`inline-flex min-w-14 justify-center rounded-full border px-3 py-1 text-xs font-semibold ${
                        winRate >= 50
                          ? "border-success-border bg-success-bg text-success"
                          : "border-danger-border bg-danger-bg text-danger-text"
                      }`}
                    >
                      {winRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-input">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, popularity)}%` }} />
                      </div>
                      <span className="w-14 text-right text-xs text-muted">{popularity.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LegacyStatsTab() {
  const { data: heroes } = usePanelData("/db/heroes");

  return (
    <section className="flex flex-col gap-4">
      <p className="text-[13px] text-dim">
        This tab still covers every Night Shift week and both regions. The Period and Region filters apply to the
        headline, Overview, Records and Leaderboards for now.
      </p>
      <HeroSelection heroes={heroes} />
    </section>
  );
}
