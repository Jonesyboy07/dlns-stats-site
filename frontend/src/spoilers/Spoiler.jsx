import React from "react";
import { useSpoilerState, revealSpoiler, hideSpoiler } from "./spoilerStore";

/**
 * Mark anything as a spoiler:
 *
 *   <Spoiler id={`match:${id}:winner`} replace="???">{winnerName}</Spoiler>
 *
 * With spoiler-free mode off the children render untouched. With it on, the
 * `replace` content (default "???") is shown as a button; clicking reveals this
 * one item and persists that choice. Use `inline={false}` for block content.
 *
 * Props:
 *   id      – stable key for per-item reveal (same id = revealed together).
 *   replace – placeholder node.
 *   reveal  – false to disable click-to-reveal (only the global toggle shows it).
 */
export default function Spoiler({
  id,
  replace = "???",
  reveal = true,
  inline = true,
  className = "",
  children,
}) {
  const { enabled, revealed } = useSpoilerState();
  const key = String(id);

  if (!enabled || revealed.includes(key)) {
    return <>{children}</>;
  }

  const Tag = inline ? "span" : "div";
  const base = `${inline ? "inline-block" : "block"} select-none text-dim ${className}`;

  if (!reveal) {
    return <Tag className={base}>{replace}</Tag>;
  }

  const doReveal = (e) => {
    e.preventDefault();
    e.stopPropagation();
    revealSpoiler(key);
  };

  return (
    <Tag
      role="button"
      tabIndex={0}
      title="Spoiler hidden. Click to reveal"
      className={`${base} cursor-pointer rounded bg-white/10 px-1 hover:bg-white/20`}
      onClick={doReveal}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") doReveal(e);
      }}
    >
      {replace}
    </Tag>
  );
}

/** Re-hide an item the user revealed. */
export { hideSpoiler };
