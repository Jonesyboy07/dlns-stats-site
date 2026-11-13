import { useEffect, useState } from 'react';

/**
 * Keeps a menu mounted for `exitMs` after it closes so it can fade out.
 * Returns `{ mounted, closing }`; render while `mounted`, and apply the exit
 * animation while `closing`.
 */
export default function usePresence(isOpen, exitMs = 100) {
  const [mounted, setMounted] = useState(isOpen);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [isOpen, exitMs]);

  return { mounted: isOpen || mounted, closing: !isOpen && mounted };
}
