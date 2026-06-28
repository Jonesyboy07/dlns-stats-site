import { useState, useEffect } from "react";
import LoadingSkeleton from "../components/LoadingSkeleton";

export default function Community() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/community")
      .then((r) => r.json())
      .then((data) => setGroups(data.groups || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingSkeleton variant="text" />;
  }

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-3xl mx-auto space-y-10">

        {/* ── header ── */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">Community Hub</h1>
          <p className="text-gray-400 text-sm">
            Links to DLNS, content creators, mods, and ways to get involved.
          </p>
        </div>

        {/* ── community link groups ── */}
        {groups.length === 0 ? (
          <p className="text-gray-500 text-sm">No community links yet.</p>
        ) : (
          <section className="space-y-6">
            {groups.map((group, idx) => (
              <GroupSection key={idx} group={group} />
            ))}
          </section>
        )}

        {/* ── contribute ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4">Contribute</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
              <h3 className="font-semibold text-white text-sm mb-2">⚡ Small Contributions</h3>
              <p className="text-gray-400 text-xs mb-3">
                Found a bug or have a feature request? Open a PR on GitHub.
              </p>
              <a
                href="https://github.com/Jonesyboy07/dlns-stats-site"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs font-medium px-3 py-1.5 rounded bg-slate-700 text-gray-300 hover:bg-slate-600"
              >
                🐙 View Repository
              </a>
            </div>
            <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
              <h3 className="font-semibold text-white text-sm mb-2">🚀 Major Contributions</h3>
              <p className="text-gray-400 text-xs mb-3">
                Want to help shape the project? Reach out on Discord.
              </p>
              <span className="inline-block text-xs font-medium px-3 py-1.5 rounded bg-purple-600/20 text-purple-300">
                💬 Message j0nesy_
              </span>
            </div>
          </div>
        </section>

        {/* ── getting started ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4">🛠 Getting Started</h2>
          <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-4">
            <ol className="text-gray-400 text-sm space-y-1.5 list-decimal list-inside mb-4">
              <li>Fork the repo on GitHub</li>
              <li>Clone your fork locally</li>
              <li><code className="bg-slate-700/60 px-1 rounded text-purple-300 text-xs">pip install -r requirements.txt</code></li>
              <li>Make your changes</li>
              <li>Submit a pull request</li>
            </ol>
            <div className="border-t border-slate-700/50 pt-3 flex flex-wrap gap-1.5">
              {["Flask", "SQLite", "React", "Tailwind", "PicoCSS", "Jinja"].map((t) => (
                <span key={t} className="text-xs px-2 py-0.5 rounded bg-slate-700/50 text-gray-400">{t}</span>
              ))}
            </div>
          </div>
        </section>

        {/* ── support ── */}
        <section>
          <h2 className="text-xl font-bold text-white mb-4">❤️ Support</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://ko-fi.com/jonesy_alr"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-300 hover:bg-orange-500/20 text-sm"
            >
              ☕ Ko‑fi
            </a>
            <a
              href="https://www.patreon.com/deadlocknightshift"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 text-sm"
            >
              ⭐ Patreon
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── group heading + items ── */
function GroupSection({ group }) {
  const hasItems = group.items?.length > 0;
  const hasSubgroups = group.groups?.length > 0;

  if (!hasItems && !hasSubgroups) return null;

  return (
    <div>
      <h2 className="text-lg font-bold text-white mb-2">{group.group}</h2>

      {hasItems && (
        <div className="space-y-1.5">
          {group.items.map((item, i) => (
            <div
              key={i}
              className="flex items-start justify-between gap-3 px-3 py-2 rounded bg-slate-800/30"
            >
              <div className="min-w-0">
                <div className="text-sm text-white">{item.name}</div>
                {item.description && (
                  <div className="text-xs text-gray-500">{item.description}</div>
                )}
              </div>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs px-2.5 py-1 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/40"
                >
                  Visit
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {hasSubgroups &&
        group.groups.map((sub, idx) => (
          <div key={idx} className="ml-4 mt-3 pl-3 border-l border-slate-700/40">
            <GroupSection group={sub} />
          </div>
        ))}
    </div>
  );
}
