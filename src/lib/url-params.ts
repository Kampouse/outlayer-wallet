/**
 * Get a value from the URL fragment (#key=...) or query param (?key=...).
 * Fragment is preferred as it's not sent to servers / logged.
 */
export function getUrlParam(key: string): string | null {
  // Try fragment first: #key=value
  const hash = window.location.hash.slice(1); // remove #
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get(key);
  if (fromHash) return fromHash;

  // Fallback to query param for backward compat: ?key=value
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(key);
}
