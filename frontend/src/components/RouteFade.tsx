import type { PropsWithChildren } from "react";
import { useLocation } from "react-router-dom";

/**
 * A short fade (180 ms) each time the route changes, including the first
 * page after sign-in. Keyed by path so only page changes replay it, not
 * search or filter changes. styles.css removes it for reduced motion.
 */
export function RouteFade({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="route-fade">
      {children}
    </div>
  );
}
