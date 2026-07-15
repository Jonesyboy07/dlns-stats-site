import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

function HomePage() {
  const [seriesList, setSeriesList] = useState([]);
  const [seriesTitle, setSeriesTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const twitchParent =
    typeof window !== "undefined" && window.location?.hostname
      ? window.location.hostname
      : "localhost";
  const twitchEmbedUrl = `https://player.twitch.tv/?channel=deadlocknightshift&parent=${encodeURIComponent(twitchParent)}&muted=true`;

  useEffect(() => {
    fetchRecentSeries();
  }, []);

  const fetchRecentSeries = async () => {
    try {
      setLoading(true);
      // Fetch both endpoints in parallel
      const [weeksRes, matchesRes] = await Promise.all([
        fetch("/db/weeks?event_title=Night+Shift"),
        fetch(
          "/db/matches/latest/paged?page=1&per_page=80&event_title=Night+Shift",
        ),
      ]);

      if (!weeksRes.ok || !matchesRes.ok)
        throw new Error("Failed to fetch data");

      const weeksData = await weeksRes.json();
      const matchesData = await matchesRes.json();

      setSeriesTitle(weeksData.title || "Night Shift");

      // Build series groups from matches
      const matches = matchesData.matches || [];
      const details = weeksData.details || {};
      const seriesMap = {};

      for (const m of matches) {
        const mid = String(m.match_id);
        const detail = details[mid];
        if (!detail) continue;

        const key = `${detail.week}_${(detail.team_a || "").toLowerCase()}_${(detail.team_b || "").toLowerCase()}`;
        if (!seriesMap[key]) {
          seriesMap[key] = {
            week: detail.week,
            series: detail.series,
            series_title: detail.series_title || "",
            team_a: detail.team_a || "TBD",
            team_b: detail.team_b || "TBD",
            wins_a: 0,
            wins_b: 0,
            matchCount: 0,
            games: [],
            firstMatchId: m.match_id,
            vod_url: "",
          };
        }
        const entry = seriesMap[key];
        entry.matchCount++;
        entry.games.push({ matchId: m.match_id });
        if (!entry.vod_url && m.match_vod) entry.vod_url = m.match_vod;
        const teamASide =
          m.event_team_a_ingame_side != null ? m.event_team_a_ingame_side : 0;
        if (m.winning_team === teamASide) entry.wins_a++;
        else if (m.winning_team != null) entry.wins_b++;
      }

      // Sort games by matchId and number them 1, 2, 3...
      for (const entry of Object.values(seriesMap)) {
        entry.games.sort((a, b) => a.matchId - b.matchId);
        entry.games.forEach((g, idx) => {
          g.game = idx + 1;
        });
      }

      const grouped = Object.values(seriesMap).sort((a, b) => {
        if (b.week !== a.week) return b.week - a.week;
        return b.firstMatchId > a.firstMatchId ? 1 : -1;
      });

      setSeriesList(grouped);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // Group by week for the card sections
  const weeks = {};
  for (const s of seriesList) {
    if (!weeks[s.week]) weeks[s.week] = [];
    weeks[s.week].push(s);
  }
  const weekEntries = Object.entries(weeks).sort(
    (a, b) => Number(b[0]) - Number(a[0]),
  );

  if (loading) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-12">
        <div className="text-center text-dim animate-pulse">
          Loading recent series…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-12">
        <div className="text-center text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="w-full px-4 py-8">
      {/* About + Recruiting */}
      <div className="mb-8 flex gap-4">
        <div className="flex-1 flex flex-col gap-4">
          <div className="flex-1 bg-panel border border-border rounded-lg p-6 mb-2">
            <h2 className="text-lg font-display font-bold text-primary mb-2">
              Deadlock Night Shift Statistics
            </h2>
            <p className="text-sm text-muted leading-relaxed">
              DLNS Stats tracks match data, player performance, and series
              results from the Deadlock Night Shift community tournaments.
              Browse recent series below, explore player profiles, or dive into
              detailed match analytics.
            </p>
          </div>

          {/* Recruiting */}
          <div className="flex items-center justify-between bg-panel border border-amber-500/20 rounded-lg px-5 py-3 gap-2">
            <div className="flex items-center">
              <span className="text-sm  text-muted normal-case leading-relaxed">
                Interested in contributing to DLNS Stats? We're looking for
                developers, designers, and data enthusiasts to help improve the
                site and add new features.
              </span>
            </div>
            <Link
              to="/help"
              className="shrink-0 text-xs font-heading font-semibold text-amber-300 hover:text-amber-200 transition-colors border border-amber-400/20 rounded-full px-3 py-1 hover:bg-amber-400/10"
            >
              Learn more →
            </Link>
          </div>
        </div>

        <div className="flex-1 bg-panel border border-accent-border rounded-lg overflow-hidden flex flex-col max-w-[600px]">
          <div className="aspect-video w-full bg-black">
            <iframe
              src={twitchEmbedUrl}
              className="w-full h-full"
              allowFullScreen
              title="Twitch stream"
            />
          </div>
        </div>
      </div>

      <h2 className="text-sm font-heading font-semibold text-muted uppercase tracking-[.1em] mb-6">
        Recent Series
      </h2>

      <div className="flex flex-col gap-6">
        {weekEntries.map(([weekNum, entries]) => {
          const weekUrl = `/week/${weekNum}?event_title=${encodeURIComponent(seriesTitle)}`;
          return (
            <div
              key={weekNum}
              className="bg-panel border border-border rounded-lg overflow-hidden"
            >
              {/* Week header — links to week page */}
              <Link
                to={weekUrl}
                className="bg-accent-bg border-b border-accent-border px-5 py-3 flex items-center gap-3 hover:bg-accent-bg-strong transition-colors"
              >
                <span className="text-[11px] font-mono font-bold text-accent-light bg-accent-bg-strong border border-accent-border rounded px-2 py-0.5 uppercase tracking-[.06em]">
                  W{weekNum}
                </span>
                <span className="text-sm font-heading font-semibold text-accent-light">
                  {seriesTitle} &mdash; Week {weekNum}
                </span>
              </Link>

              {/* Series rows */}
              <div className="divide-y divide-border-dashed">
                {entries.map((entry, i) => {
                  const maxWins = Math.max(entry.wins_a, entry.wins_b);
                  const totalGames = maxWins > 1 ? maxWins * 2 - 1 : 1;
                  const aWon = entry.wins_a > entry.wins_b;
                  const bWon = entry.wins_b > entry.wins_a;

                  return (
                    <div
                      key={i}
                      className="pb-5 pt-3 px-3 hover:bg-white/[0.02] transition-colors group"
                    >
                      {/* Top row: format badge + series title */}
                      <div className="flex items-center pl-2 gap-2 mb-1">
                        <span className="text-[10px] font-mono font-semibold text-dim bg-white/[0.04] border border-border rounded px-2 py-0.5">
                          BO{totalGames}
                        </span>
                        {entry.series_title && (
                          <span className="text-[10px] font-heading font-semibold text-accent-light uppercase tracking-[.05em]">
                            {entry.series_title}
                          </span>
                        )}
                      </div>

                      {/* Bottom row: teams + score + pills + series link */}
                      <div className="flex items-center">
                        {/* Team A — right-aligned */}
                        <Link
                          to={`/team/${encodeURIComponent(entry.team_a)}`}
                          className={`flex-1 text-sm font-heading font-semibold text-right hover:underline ${
                            aWon ? "text-success" : "text-primary"
                          }`}
                        >
                          {entry.team_a}
                        </Link>

                        {/* VOD link */}
                        {entry.vod_url && (
                          <a
                            href={entry.vod_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 text-dim hover:text-red-400 transition-colors mr-2"
                            title="Watch VOD"
                          >
                            <svg
                              className="w-4 h-4"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                            </svg>
                          </a>
                        )}

                        {/* Center: score on top, game pills below */}
                        <div className="min-w-[75px] flex flex-col items-center mx-4">
                          <span
                            className={`text-sm font-mono font-bold ${
                              aWon === bWon ? "text-dim" : "text-primary"
                            }`}
                          >
                            {entry.wins_a} <span className="text-dim">—</span>{" "}
                            {entry.wins_b}
                          </span>
                          <div className="flex items-center justify-center gap-1.5 mt-1">
                            {Array.from({ length: totalGames }, (_, idx) => {
                              const played = entry.games[idx];
                              return played ? (
                                <Link
                                  key={played.game}
                                  to={`/match/${played.matchId}`}
                                  className="w-5 h-5 rounded-full bg-success/20 border border-success/30 flex items-center justify-center text-[10px] font-mono font-bold text-success hover:bg-success/30 transition-colors"
                                >
                                  {played.game}
                                </Link>
                              ) : (
                                <span
                                  key={`ghost-${idx}`}
                                  className="w-5 h-5 rounded-full bg-white/[0.03] border border-border flex items-center justify-center text-[10px] font-mono text-dim/40"
                                >
                                  {idx + 1}
                                </span>
                              );
                            })}
                          </div>
                        </div>

                        {/* Team B — left-aligned */}
                        <Link
                          to={`/team/${encodeURIComponent(entry.team_b)}`}
                          className={`flex-1 text-sm font-heading font-semibold hover:underline ${
                            bWon ? "text-success" : "text-primary"
                          }`}
                        >
                          {entry.team_b}
                        </Link>

                        {/* Series link */}
                        <Link
                          to={`/series/${entry.firstMatchId}`}
                          className="ml-4 shrink-0 text-xs text-accent-light hover:text-accent transition-colors font-heading font-semibold tracking-[.02em]"
                        >
                          View series →
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HomePage;
