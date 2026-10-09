import type { Data } from "./types";
export const claimPeriods = [
  "Annual",
  "Monthly",
  "Daily",
  "Per trip",
  "Per request",
] as const;
/** The same reservation boundary is used in the form and in the locked server transaction. */
export function sameClaimPeriod(period: unknown, claim: Data, target: Data) {
  const date = String(target.date || ""),
    other = String(claim.date || "");
  if (period === "Per request") return false;
  if (period === "Per trip")
    return (
      !!String(target.tripReference || "").trim() &&
      String(claim.tripReference || "")
        .trim()
        .toLowerCase() === String(target.tripReference).trim().toLowerCase()
    );
  if (!date || !other) return false;
  return period === "Daily"
    ? date === other
    : other.startsWith(date.slice(0, period === "Annual" ? 4 : 7));
}
