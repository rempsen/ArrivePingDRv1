/**
 * "Is this an address our server may fetch on a stranger's say-so?"
 *
 * The signup scan fetches whatever website a visitor types. The address is
 * checked when it is submitted (api/lib/validate.ts `outboundUrl`), but that
 * check reads the text of the URL only. Two ways around it:
 *   - a public name that RESOLVES to a private address (10.x, 127.x, the
 *     cloud metadata address 169.254.169.254);
 *   - a public page that REDIRECTS to one.
 * So the scan checks every hop, by name and by the addresses the name
 * resolves to, before requesting it.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function v4Private(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  return (
    a === 0 || // "this network"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // protocol assignments, test net
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for any address that is not an ordinary public internet address. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return v4Private(ip);
  if (kind !== 6) return true;
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  // IPv4 written inside IPv6 (::ffff:10.0.0.1, and the hex form ::ffff:a00:1)
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)?.[1];
  if (dotted) return v4Private(dotted);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return v4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff") || v.startsWith("64:ff9b:") || v.startsWith("2001:db8:");
}

type Resolver = (host: string) => Promise<string[]>;
const systemResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
let resolver: Resolver = systemResolver;
/** Tests swap DNS out. */
export function _setResolverForTests(r: Resolver | null): void {
  resolver = r ?? systemResolver;
}

export type UrlCheck = { ok: true } | { ok: false; why: "not_web" | "private" | "no_such_host" };

/** http(s), a real public host name, and every address it resolves to is public. */
export async function checkPublicUrl(url: string): Promise<UrlCheck> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, why: "not_web" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, why: "not_web" };
  if (u.username || u.password) return { ok: false, why: "not_web" };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? { ok: false, why: "private" } : { ok: true };
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) return { ok: false, why: "private" };
  let addrs: string[];
  try {
    addrs = await resolver(host);
  } catch {
    return { ok: false, why: "no_such_host" };
  }
  if (!addrs.length) return { ok: false, why: "no_such_host" };
  // One private answer is enough to refuse: which one gets used is not ours to pick.
  return addrs.some(isPrivateAddress) ? { ok: false, why: "private" } : { ok: true };
}
