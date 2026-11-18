/** Issue 194: whether comped subscriptions count toward a product's cap, from `COMPS_COUNT_TOWARD_CAP`: true only for "true". */
export function compsCountTowardCap(env: { COMPS_COUNT_TOWARD_CAP?: string }): boolean {
  return env.COMPS_COUNT_TOWARD_CAP === "true";
}
