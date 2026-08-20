import { Link } from "react-router-dom";
import { cdnImage } from "../utils/cdn";

export default function MatchHeader({
  matchId = "93812686",
  weekLabel = "Night Shift #47",
  date = "Jul 14, 2026 · 17:12",
  winner = null, // "amber" | "sapphire" | null
  games = [1, 2, 3],
  activeGame = 2,
  seriesUrl = "#",
  weekUrl,
  setTitle,
  vodUrl = "",
  amberTeamName = "Amber",
  sapphireTeamName = "Sapphire",
  amberSouls = 0,
  sapphireSouls = 0,
  amberKda = { k: 0, d: 0, a: 0 },
  sapphireKda = { k: 0, d: 0, a: 0 },
}) {
  return (
    <div className="w-full bg-panel border border-border rounded-t-lg shadow-lg overflow-hidden">
      {/* Top meta row */}
      <div className="flex justify-between items-center px-5 pt-4 pb-3 border-b border-border-dashed">
        <div className="flex items-center gap-2.5 text-[13px] font-heading font-medium text-muted tracking-[.04em] uppercase">
          <span className="text-dim">
            Match{" "}
            <span className="text-secondary tracking-normal">
              {matchId}
            </span>
          </span>
                    {setTitle && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-dim" />
              <span className="text-dim">{setTitle}</span>
            </>
          )}
          <span className="w-[3px] h-[3px] rounded-full bg-dim" />
          {weekUrl ? (
            <a
              href={weekUrl}
              className="text-accent-light hover:text-accent-light/80 transition-colors"
            >
              {weekLabel}
            </a>
          ) : (
            <span className="text-accent-light">{weekLabel}</span>
          )}

        </div>

        <div className="flex items-center gap-3.5">
          <span className="text-[13px] font-body font-normal text-dim">
            {date}
          </span>

          {vodUrl ? (
            <a
              href={vodUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Watch the match VOD"
              className="text-[13px] font-heading font-semibold tracking-[.02em] flex items-center gap-1.5 text-red-400/90 hover:text-accent transition-colors"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch VOD
            </a>
          ) : null}
          <a
            href={seriesUrl}
            className="text-[13px] font-heading font-semibold tracking-[.02em] flex items-center gap-1 text-accent-light hover:text-accent transition-colors"
          >
            View Full Series →
          </a>
        </div>
      </div>

      {/* Team row: amber | series games | sapphire */}
      <div className="flex items-stretch justify-between gap-4 px-5 py-4 bg-gradient-to-r from-amber-950/40 via-gray-900/60 to-blue-950/40">
        {/* Team A (amber / left) */}
        <div className="flex-1 flex items-center gap-4 min-w-0">
          <img
            src={cdnImage("teamNames/team1_patron_logo_psd.png")}
            alt=""
            className="h-14 w-14 object-contain shrink-0"
            style={{
              filter:
                "brightness(0) saturate(100%) invert(64%) sepia(14%) saturate(3308%) hue-rotate(1deg) brightness(106%) contrast(103%)",
            }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {amberTeamName ? (
                <Link
                  to={`/team/${encodeURIComponent(amberTeamName)}`}
                  className="block text-amber-50 text-2xl font-bold uppercase hover:underline truncate"
                >
                  {amberTeamName}
                </Link>
              ) : (
                <span className="block text-amber-300 text-2xl font-bold uppercase">
                  Amber
                </span>
              )}
              {winner === "amber" && <WinBadge />}
            </div>
            <div className="text-sm text-amber-100/80 mt-0.5 whitespace-nowrap">
              <span className="text-amber-300 font-semibold">
                {amberSouls.toLocaleString()} souls
              </span>
              <span className="text-gray-500 mx-2">·</span>
              <span className="text-green-400 font-semibold">{amberKda.k}</span>
              <span className="text-gray-500"> / </span>
              <span className="text-red-400">{amberKda.d}</span>
              <span className="text-gray-500"> / </span>
              <span className="text-orange-400">{amberKda.a}</span>
            </div>
          </div>
        </div>

        {/* Center: series games */}
        <div className="flex flex-col items-center justify-center px-6 border-x border-gray-700 shrink-0">
          <div className="text-[11px] font-heading font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Series Games
          </div>
          <div className="flex items-center gap-2">
            {games.map((g) => {
              const gameNum = typeof g === "object" ? g.game : g;
              const gameMatchId = typeof g === "object" ? g.matchId : null;
              const active = gameNum === activeGame;
              return (
                <a
                  key={gameNum}
                  href={gameMatchId ? `/match/${gameMatchId}` : "#"}
                  className={`px-3 py-1 text-xs font-heading font-semibold tracking-[.03em] rounded-full transition-colors ${
                    active
                      ? "bg-accent-bg-strong border border-accent-border text-accent-light"
                      : "bg-transparent border border-border text-dim hover:bg-white/5"
                  }`}
                >
                  {String(gameNum).replace(/^Game\s*/i, "")}
                </a>
              );
            })}
          </div>
        </div>

        {/* Team B (sapphire / right) */}
        <div className="flex-1 flex items-center justify-end gap-4 min-w-0">
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              {winner === "sapphire" && <WinBadge />}
              {sapphireTeamName ? (
                <Link
                  to={`/team/${encodeURIComponent(sapphireTeamName)}`}
                  className="block text-blue-200 text-2xl font-bold uppercase hover:underline truncate"
                >
                  {sapphireTeamName}
                </Link>
              ) : (
                <span className="block text-blue-200 text-2xl font-bold uppercase">
                  Sapphire
                </span>
              )}
            </div>
            <div className="text-sm text-blue-100/80 mt-0.5 whitespace-nowrap">
              <span className="text-blue-400 font-semibold">
                {sapphireSouls.toLocaleString()} souls
              </span>
              <span className="text-gray-500 mx-2">·</span>
              <span className="text-green-400 font-semibold">
                {sapphireKda.k}
              </span>
              <span className="text-gray-500"> / </span>
              <span className="text-red-400">{sapphireKda.d}</span>
              <span className="text-gray-500"> / </span>
              <span className="text-orange-400">{sapphireKda.a}</span>
            </div>
          </div>
          <img
            src={cdnImage("teamNames/team2_patron_logo_psd.png")}
            alt=""
            className="h-14 w-14 object-contain shrink-0"
            style={{
              filter:
                "brightness(0) saturate(100%) invert(24%) sepia(96%) saturate(1698%) hue-rotate(203deg) brightness(94%) contrast(115%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function WinBadge() {
  return (
    <span className="px-2.5 py-0.5 text-[11px] font-heading font-semibold tracking-[.05em] rounded-full bg-success-bg border border-success-border text-success shrink-0">
      WIN
    </span>
  );
}
