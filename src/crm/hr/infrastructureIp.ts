/**
 * Does this address belong to a hosting provider rather than a consumer ISP?
 *
 * A deliberately small, well-known list rather than a lookup service: the point
 * is to catch the one mistake that actually happened -- reading the platform's
 * own load balancer instead of the client -- loudly and offline. A false
 * negative just means no warning; there are no false positives worth worrying
 * about, because an office does not sit inside AWS.
 */
export function looksLikeInfrastructure(ip: string): boolean {
  const RANGES: [string, number][] = [
    ['13.248.', 2], ['99.82.', 2],        // AWS Global Accelerator
    ['3.', 1], ['52.', 1], ['54.', 1],    // AWS
    ['34.', 1], ['35.', 1],               // Google Cloud
    ['104.16.', 2], ['172.64.', 2],       // Cloudflare
    ['20.', 1], ['40.', 1],               // Azure
  ];
  return RANGES.some(([prefix]) => ip.startsWith(prefix));
}
