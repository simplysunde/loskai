// A subdomain is a single DNS label: lowercase letters, digits, hyphens; not starting
// or ending with a hyphen. Single-label only keeps every name under the one
// *.BASE_DOMAIN wildcard cert (see PLAN, Assign URL).
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function isValidPrefix(prefix: string): boolean {
  return prefix.length > 0 && prefix.length <= 63 && LABEL.test(prefix);
}

export function assembleFqdn(prefix: string, baseDomain: string): string {
  return `${prefix}.${baseDomain}`;
}
