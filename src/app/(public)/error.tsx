"use client";

import { RouteError } from "@/components/route-states";

/** Public pages run full-bleed under the floating nav, so the error card brings its own top space. */
export default function PublicError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="px-5 pt-24 sm:px-6">
      <RouteError {...props} />
    </div>
  );
}
