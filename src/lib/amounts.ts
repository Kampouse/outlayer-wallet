/**
 * Amount conversion utilities for NEAR and FT (fungible token) amounts.
 * Shared across all wallet pages (Send, Swap, Fund).
 */

/** Convert human-readable NEAR amount to yoctoNEAR string */
export function nearToYocto(amount: string): string {
  const parsed = parseFloat(amount);
  if (isNaN(parsed) || parsed <= 0) throw new Error("Invalid amount");
  const yocto = BigInt(Math.round(parsed * 1e6)) * BigInt(1e18);
  return yocto.toString();
}

/** Convert human-readable amount to FT minimal units using decimals */
export function toMinimalUnits(amount: string, decimals: number): string {
  const parts = amount.split(".");
  const whole = parts[0] || "0";
  const frac = (parts[1] || "").padEnd(decimals, "0").slice(0, decimals);
  const result = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
  return result.toString();
}
