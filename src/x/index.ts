import "server-only";
import { xConfig } from "@/config/env";
import { XApi } from "./api";
import type { XPort } from "./port";

/**
 * Composition root for X. Created on first use so importing this module never
 * reads the environment (build safety). Null when the deployment has no X
 * credentials: Sign in with X is then off.
 */
let wired: { x: XPort | null } | undefined;

export function getX(): XPort | null {
  if (!wired) {
    const config = xConfig();
    wired = { x: config ? new XApi(config) : null };
  }
  return wired.x;
}
