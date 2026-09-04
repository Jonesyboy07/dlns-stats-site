import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

/**
 * Resets the window scroll to the top whenever the route (pathname) changes.
 * The very first render is skipped so a page refresh or deep link keeps the
 * browser's restored scroll position instead of jumping to the top.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
