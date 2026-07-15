import React, { useMemo } from "react";

function getHelpConfig() {
  if (typeof window !== "undefined" && window.__DLNS_HELP_CONFIG__) {
    return window.__DLNS_HELP_CONFIG__;
  }
  return {
    title: "Help & Contribute",
    intro: "Want to help improve DLNS Stats?",
    banner: {
      enabled: false,
      badge: "",
      title: "",
      message: "",
      details: [],
      cta: { label: "", url: "" },
    },
    sections: [],
    support: { title: "", body: "", links: [] },
  };
}

export default function Help() {
  const config = useMemo(() => getHelpConfig(), []);
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const supportLinks = Array.isArray(config.support?.links) ? config.support.links : [];

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-5xl mx-auto space-y-8">
        <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6">
          <h1 className="text-3xl font-bold text-white">{config.title || "Help & Contribute"}</h1>
          {config.intro ? <p className="mt-3 text-slate-300">{config.intro}</p> : null}

          {config.banner?.enabled ? (
            <div className="mt-5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-5">
              {config.banner.badge ? (
                <span className="inline-block rounded-full bg-indigo-400/20 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-200">
                  {config.banner.badge}
                </span>
              ) : null}
              {config.banner.title ? <h2 className="mt-3 text-xl font-semibold">{config.banner.title}</h2> : null}
              {config.banner.message ? <p className="mt-2 text-slate-300">{config.banner.message}</p> : null}

              {Array.isArray(config.banner.details) && config.banner.details.length > 0 ? (
                <ul className="mt-3 list-disc list-inside text-slate-300 space-y-1">
                  {config.banner.details.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : null}

              {config.banner.cta?.url ? (
                <a
                  href={config.banner.cta.url}
                  className="inline-block mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
                >
                  {config.banner.cta.label || "Learn more"}
                </a>
              ) : null}
            </div>
          ) : null}
        </section>

        {sections.length > 0 ? (
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sections.map((section, idx) => {
              const bullets = Array.isArray(section.bullets) ? section.bullets : [];
              const steps = Array.isArray(section.steps) ? section.steps : [];
              const subsections = Array.isArray(section.subsections) ? section.subsections : [];

              return (
                <article
                  key={section.id || idx}
                  className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5"
                >
                  <h2 className="text-lg font-semibold flex items-center gap-2">
                    <span>{section.icon || "•"}</span>
                    <span>{section.title || "Untitled"}</span>
                  </h2>

                  {section.body ? <p className="mt-3 text-slate-300">{section.body}</p> : null}

                  {bullets.length > 0 ? (
                    <ul className="mt-3 list-disc list-inside text-slate-300 space-y-1">
                      {bullets.map((item, itemIdx) => (
                        <li key={itemIdx}>{item}</li>
                      ))}
                    </ul>
                  ) : null}

                  {steps.length > 0 ? (
                    <ol className="mt-3 list-decimal list-inside text-slate-300 space-y-1">
                      {steps.map((item, stepIdx) => (
                        <li key={stepIdx}>{item}</li>
                      ))}
                    </ol>
                  ) : null}

                  {subsections.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      {subsections.map((subsection, subIdx) => (
                        <div key={subIdx} className="rounded-md bg-slate-800/40 p-3">
                          <h3 className="font-medium text-white">{subsection.title || "Details"}</h3>
                          {Array.isArray(subsection.bullets) && subsection.bullets.length > 0 ? (
                            <ul className="mt-2 list-disc list-inside text-slate-300 space-y-1">
                              {subsection.bullets.map((item, bulletIdx) => (
                                <li key={bulletIdx}>{item}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {section.cta?.url ? (
                    <a
                      href={section.cta.url}
                      target={String(section.cta.url).startsWith("http") ? "_blank" : undefined}
                      rel={String(section.cta.url).startsWith("http") ? "noopener noreferrer" : undefined}
                      className="inline-block mt-4 rounded-md border border-slate-500/50 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700/40"
                    >
                      {section.cta.label || "Open"}
                    </a>
                  ) : null}
                </article>
              );
            })}
          </section>
        ) : (
          <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-amber-100">
            Help content is not configured yet.
          </section>
        )}

        {config.support ? (
          <section className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6">
            <h2 className="text-xl font-semibold">{config.support.title || "Support"}</h2>
            {config.support.body ? <p className="mt-2 text-slate-200">{config.support.body}</p> : null}
            {supportLinks.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {supportLinks.map((link, idx) => (
                  link?.url ? (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500"
                    >
                      {link.label || "Support"}
                    </a>
                  ) : null
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
