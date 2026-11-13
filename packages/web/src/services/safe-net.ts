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
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

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

/** `addresses`: what the name resolved to when it was checked. The request must connect to one of these. */
export type UrlCheck = { ok: true; addresses: string[] } | { ok: false; why: "not_web" | "private" | "no_such_host" };

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
  if (isIP(host)) return isPrivateAddress(host) ? { ok: false, why: "private" } : { ok: true, addresses: [host] };
  if (!host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)) return { ok: false, why: "private" };
  let addrs: string[];
  try {
    addrs = await resolver(host);
  } catch {
    return { ok: false, why: "no_such_host" };
  }
  if (!addrs.length) return { ok: false, why: "no_such_host" };
  // One private answer is enough to refuse: which one gets used is not ours to pick.
  return addrs.some(isPrivateAddress) ? { ok: false, why: "private" } : { ok: true, addresses: addrs };
}

/**
 * GET a URL, connecting ONLY to an address that was already checked.
 *
 * A plain fetch looks the name up again when it connects. A hostile name can
 * answer the check with a public address and the connection with an internal
 * one (DNS rebinding). Here the connection's own lookup is replaced with the
 * checked address, so there is no second answer to swap. The host name still
 * goes in the TLS handshake and the Host header, so certificates are verified
 * as usual. Redirects are not followed: the caller checks each hop.
 */

export async function pinnedGet(
  url: string,
  addresses: string[],
  opts: { headers: Record<string, string>; signal: AbortSignal; maxBytes: number },
): Promise<Response> {
  const u = new URL(url);
  // Prefer IPv4: many hosts have no working IPv6 route.
  const address = addresses.find((a) => isIP(a) === 4) ?? addresses[0];
  if (!address || isPrivateAddress(address)) throw Object.assign(new Error("no public address to connect to"), { code: "EHOSTUNREACH" });
  const family = isIP(address) === 6 ? 6 : 4;
  const mod = u.protocol === "https:" ? https : http;
  return new Promise<Response>((resolve, reject) => {
    const fail = (e: unknown) => reject(e);
    const req = mod.request(
      {
        protocol: u.protocol,
        host: u.hostname.replace(/^\[|\]$/g, ""),
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { ...opts.headers, "accept-encoding": "gzip, deflate, br" },
        // The pin: whatever asks, the answer is the address we checked.
        lookup: ((_host: string, o: unknown, cb: (...a: unknown[]) => void) => {
          const done = typeof o === "function" ? (o as typeof cb) : cb;
          if (o && typeof o === "object" && (o as { all?: boolean }).all) done(null, [{ address, family }]);
          else done(null, address, family);
        }) as never,
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
        const status = res.statusCode ?? 0;
        // Redirects and errors: the caller only needs the status and headers.
        if (status < 200 || status >= 300) {
          res.resume();
          resolve(new Response(null, { status: status >= 200 && status <= 599 ? status : 502, headers }));
          return;
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const body = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        headers.delete("content-encoding");
        headers.delete("content-length");
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve(new Response(new Uint8Array(Buffer.concat(chunks).subarray(0, opts.maxBytes)), { status, headers }));
        };
        body.on("data", (c: Buffer) => {
          chunks.push(c);
          size += c.length;
          if (size >= opts.maxBytes) {
            finish();
            req.destroy();
          }
        });
        body.on("end", finish);
        // A page cut off mid-stream still has its head and most of its text.
        body.on("error", (e) => (size > 0 ? finish() : fail(e)));
      },
    );
    const onAbort = () => req.destroy(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }));
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
    req.on("error", fail);
    req.end();
  });
}
