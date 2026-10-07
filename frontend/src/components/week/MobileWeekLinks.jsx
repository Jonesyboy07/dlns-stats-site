import React from "react";

/**
 * MobileWeekLinks — the 16a week links: two lines of text links with no captions.
 *
 * The stream and the new hero share the first line and the patch takes the second,
 * sitting on a negative margin so their 44px tap areas overlap by 12px. The stream
 * never shrinks; a long hero title ends in an ellipsis instead. With one of the
 * first line's links missing the dot goes too, and with neither the line goes.
 *
 * Props:
 *   facts — {stream, hero, patch}, each `{href, title, name?}` or null
 */
export default function MobileWeekLinks({ facts }) {
  const { stream, hero, patch } = facts;
  if (!stream && !hero && !patch) return null;

  return (
    <div className="-mt-2.5 -mb-1.5 flex flex-col">
      {(stream || hero) && (
        <div className="flex min-w-0 items-center gap-3">
          {stream && (
            <a
              href={stream.href}
              target="_blank"
              rel="noopener noreferrer"
              title={stream.title}
              className="flex min-h-11 shrink-0 items-center gap-1.5 font-valve-oracle text-[13px] font-semibold whitespace-nowrap text-primary active:text-accent-light"
            >
              <span aria-hidden="true" className="shrink-0 text-accent-light">
                ▶
              </span>
              VOD
              <span aria-hidden="true" className="shrink-0 text-accent-light">
                ↗
              </span>
            </a>
          )}
          {stream && hero && (
            <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-dim" />
          )}
          {hero && (
            <a
              href={hero.href}
              target="_blank"
              rel="noopener noreferrer"
              title={hero.title}
              className="flex min-h-11 min-w-0 items-center gap-1.5 font-valve-oracle text-[13px] font-semibold whitespace-nowrap text-primary active:text-accent-light"
            >
              <span className="min-w-0 overflow-hidden text-ellipsis">{hero.name}</span>
              <span aria-hidden="true" className="shrink-0 text-accent-light">
                ↗
              </span>
            </a>
          )}
        </div>
      )}

      {patch && (
        <a
          href={patch.href}
          target="_blank"
          rel="noopener noreferrer"
          title={patch.title}
          className="-mt-3 flex min-h-11 min-w-0 items-center gap-1.5 text-[13px] font-medium whitespace-nowrap text-muted active:text-accent-light"
        >
          <span className="min-w-0 overflow-hidden text-ellipsis">{patch.name}</span>
          <span aria-hidden="true" className="shrink-0 text-accent-light">
            ↗
          </span>
        </a>
      )}
    </div>
  );
}
