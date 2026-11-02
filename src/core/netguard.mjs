// Outbound calls to addresses a tenant chose: the customer's AI, a help desk base URL, an alert webhook, an
// SSO issuer. On a shared server a tenant must not aim Delomu at the server's own network (localhost, the cloud
// metadata address, private ranges), so the server turns the guard on and each such call first checks every
// address the host name resolves to, and refuses redirects. The CLI leaves it off: there localhost is normal.
// A host that changes its DNS answer between this check and the request itself is not covered here.

import dns from 'node:dns/promises';
import net from 'node:net';

let blocked = false;
export const blockPrivateTargets = on => { blocked = Boolean(on); };
export const privateTargetsBlocked = () => blocked;

const V4_PRIVATE = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4Number = ip => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const inV4 = (ip, [base, bits]) => (v4Number(ip) >>> (32 - bits)) === (v4Number(base) >>> (32 - bits));

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return V4_PRIVATE.some(range => inV4(ip, range));
  const v6 = String(ip).toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateAddress(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

// Throws when the guard is on and the URL's host is, or resolves to, a private or local address.
export async function assertPublicUrl(url, { lookup = dns.lookup } = {}) {
  if (!blocked) return;
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true })).map(a => a.address);
  const bad = addresses.find(isPrivateAddress);
  if (bad || !addresses.length) {
    throw new Error(`${host} resolves to a private or local address${bad ? ` (${bad})` : ''}; this server only calls public addresses`);
  }
}

// fetch's redirect mode under the guard: a public URL must not bounce the request somewhere private.
export const redirectMode = () => (blocked ? 'error' : 'follow');
