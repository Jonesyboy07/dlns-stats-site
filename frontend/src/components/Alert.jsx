import React from "react";

const VARIANTS = {
  warning: { box: "border-warning-border bg-warning-bg", title: "text-warning" },
  danger: { box: "border-danger-border bg-danger-bg", title: "text-danger-text" },
  info: { box: "border-accent-border bg-accent-bg", title: "text-accent-light" },
};

/** A tinted notice: a bold title, then the message. `action` sits at the end of the line. */
export default function Alert({ variant = "warning", title, action = null, className = "", children }) {
  const style = VARIANTS[variant] ?? VARIANTS.warning;
  return (
    <div role="status" className={`rounded-lg border px-3.5 py-2.5 text-[14px] text-primary ${style.box} ${className}`}>
      {title && <b className={`mr-1.5 font-semibold ${style.title}`}>{title}</b>}
      {children}
      {action && <span className="ml-1.5">{action}</span>}
    </div>
  );
}
