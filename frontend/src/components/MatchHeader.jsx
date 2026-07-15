export default function MatchHeader({
  matchId = "93812686",
  weekLabel = "Night Shift #47",
  date = "Jul 14, 2026 · 17:12",
  teamA = "LEVIATHAN",
  teamB = "SLICE N DICE",
  winner = "teamA",
  games = [1, 2, 3],
  activeGame = 2,
  seriesUrl = "#",
  weekUrl,
  seriesTitle,
  setTitle,
}) {
  return (
    <div className="w-full bg-panel border border-border rounded-lg shadow-lg px-5 py-6 mb-4">
      <div className="flex justify-between items-center pb-3.5 mb-4 border-b border-border-dashed">
        <div className="flex items-center gap-2.5 text-[13px] font-heading font-medium text-muted tracking-[.04em] uppercase">
          <span>
            Match{" "}
            <span className="text-secondary font-mono tracking-normal">{matchId}</span>
          </span>
          <span className="w-[3px] h-[3px] rounded-full bg-dim" />
          {weekUrl ? (
            <a href={weekUrl} className="text-accent-light hover:text-accent transition-colors">{weekLabel}</a>
          ) : (
            <span className="text-accent-light">{weekLabel}</span>
          )}
          {setTitle && (
            <>
              <span className="w-[3px] h-[3px] rounded-full bg-dim" />
              <span className="text-accent-light">{setTitle}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3.5">
          <span className="text-[13px] font-body font-normal text-dim">{date}</span>
          <a
            href={seriesUrl}
            className="text-[13px] font-heading font-semibold tracking-[.02em] flex items-center gap-1 text-accent-light hover:text-accent transition-colors"
          >
            View Full Series →
          </a>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-baseline gap-4">
          <span className="text-[32px] font-display font-bold text-primary tracking-[.01em]">
            {teamA}
            {winner === "teamA" && <WinBadge />}
          </span>
          <span className="text-base font-heading font-medium text-dim">VS</span>
          <span className="text-[32px] font-display font-bold text-primary tracking-[.01em]">
            {teamB}
            {winner === "teamB" && <WinBadge />}
          </span>
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
                {gameNum}
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function WinBadge() {
  return (
    <span className=" mx-2.5 px-2.5 py-0.5 text-[11px] font-heading font-semibold tracking-[.05em] rounded-full bg-success-bg border border-success-border text-success">
      WIN
    </span>
  );
}
