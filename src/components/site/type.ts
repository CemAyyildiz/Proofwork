/*
 * The display-type helpers of the motion kit, for server components: a
 * "use client" module's exports cannot be called on the server, so these
 * mirror `axes` and `FONT` from components/e/motion.
 */

/** Anybody, the variable display face. */
export const FONT = "font-display";

/** `font-variation-settings` for a width (50–150) and a weight (100–900). */
export const axes = (wdth: number, wght: number) => `"wdth" ${wdth.toFixed(1)}, "wght" ${wght.toFixed(0)}`;
