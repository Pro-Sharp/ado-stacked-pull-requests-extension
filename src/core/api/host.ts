import * as SDK from "azure-devops-extension-sdk";
import { ILocationService } from "azure-devops-extension-api";

/**
 * Host differences between Azure DevOps Services (cloud) and Azure DevOps Server (on-prem):
 * the collection URL is not always `https://dev.azure.com/{org}`, and older servers reject the
 * `7.2-preview` API versions that `azure-devops-extension-api` hard-codes on every call.
 */

/** Collection (organization) root URL with a trailing slash, e.g. `https://tfs.contoso.local/DefaultCollection/`. */
export function collectionUrl(): Promise<string> {
  return (cachedCollectionUrl ??= resolveCollectionUrl());
}

let cachedCollectionUrl: Promise<string> | undefined;

async function resolveCollectionUrl(): Promise<string> {
  try {
    const location = await SDK.getService<ILocationService>("ms.vss-features.location-service");
    const url = await location.getServiceLocation();
    if (url) return withTrailingSlash(url);
  } catch {
    // Fall through to the cloud default below.
  }
  return `https://dev.azure.com/${encodeURIComponent(SDK.getHost().name)}/`;
}

export function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

// ---- Access token -----------------------------------------------------------------------------

let lastToken: string | undefined;

/**
 * Expiry (ms) of the extension token: its `ado_exp` claim, which Azure DevOps enforces before the AAD `exp`
 * (`hostUntil`, when the host replaces its cached token).
 */
function tokenExpiry(token: string): { exp: number; hostUntil?: number } | undefined {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const attrs = Object.values(payload.xms_attr ?? {}) as { ado_exp?: number }[];
    const exp = attrs.map((a) => a?.ado_exp).find((e): e is number => typeof e === "number") ?? payload.exp;
    if (typeof exp !== "number") return undefined;
    return { exp: exp * 1000, hostUntil: typeof payload.exp === "number" ? payload.exp * 1000 : undefined };
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The host hands out a cached extension token that Azure DevOps stops accepting (as anonymous, TF400813)
 * a few minutes before the host replaces it. With `rejected` the token that just got a 401 is asked for
 * again until the host serves a different one that is still valid.
 */
export async function getFreshAccessToken(rejected = false): Promise<string> {
  const isExpired = (t: string) => {
    const info = tokenExpiry(t);
    return info !== undefined && info.exp < Date.now() + 15_000;
  };
  let token = await SDK.getAccessToken();
  for (let attempt = 1; attempt <= 4; attempt++) {
    if (!((rejected && token === lastToken) || isExpired(token))) break;
    await sleep(600 * attempt);
    token = await SDK.getAccessToken();
  }
  lastToken = token;
  if (isExpired(token)) {
    // The host keeps serving its cached token until the AAD expiry; nothing in the extension can renew it earlier.
    const until = tokenExpiry(token)?.hostUntil;
    const when = until ? ` at ${new Date(until).toLocaleTimeString()}` : " shortly";
    throw Object.assign(
      new Error(`Azure DevOps handed this extension an expired access token. It renews it${when}; reload the page then.`),
      { status: 401 }
    );
  }
  return token;
}

/** Auth provider for the SDK REST clients (the default one never asks the host for a new token). */
export const authTokenProvider = {
  getAuthorizationHeader: async (refresh?: boolean): Promise<string> => {
    const token = await getFreshAccessToken(!!refresh);
    return token ? `Bearer ${token}` : "";
  }
};

// ---- API version negotiation -----------------------------------------------------------------

/** Highest API version the server reported, learned from the first out-of-range rejection. */
let maxApiVersion: string | undefined;

/** Test hook. */
export function resetApiVersion(value?: string): void {
  maxApiVersion = value;
}

/** Parses the server's limit out of a VssVersionOutOfRangeException message. */
export function parseMaxApiVersion(message: string): string | undefined {
  return /latest REST API version this server supports is (\d+(?:\.\d+)*)/i.exec(message)?.[1];
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Lowers `requested` (e.g. `7.2-preview.3`) to at most `max` (e.g. `7.0`), keeping the preview flag.
 * With `resetResource` the resource version drops to 1, for servers that also lack the newer resource revision.
 */
export function downgradeApiVersion(requested: string, max: string | undefined, resetResource = false): string {
  const m = /^(\d+(?:\.\d+)?)(-preview(?:\.(\d+))?)?$/.exec(requested);
  if (!m || !max || compareVersions(m[1], max) <= 0) return requested;
  if (!m[2]) return max;
  return `${max}-preview.${resetResource ? 1 : m[3] ?? 1}`;
}

function errorMessage(e: unknown): string {
  const err = e as { message?: string; serverError?: { message?: string } };
  return err?.serverError?.message ?? err?.message ?? String(e);
}

function isVersionError(e: unknown): boolean {
  return (e as { status?: number })?.status === 400 && /version/i.test(errorMessage(e));
}

/**
 * Sends a request at the negotiated API version. The first time a server rejects a version as out of
 * range its limit is remembered and the request is retried; on the cloud nothing is ever rewritten.
 */
export async function withApiVersion<T>(requested: string, send: (apiVersion: string) => Promise<T>): Promise<T> {
  const first = downgradeApiVersion(requested, maxApiVersion);
  try {
    return await send(first);
  } catch (e) {
    if (!isVersionError(e)) throw e;
    const reported = parseMaxApiVersion(errorMessage(e));
    if (reported) maxApiVersion = reported;
    const second = downgradeApiVersion(requested, maxApiVersion);
    if (second !== first) {
      try {
        return await send(second);
      } catch (e2) {
        if (!isVersionError(e2)) throw e2;
      }
    }
    // The resource revision may be newer than the server has; resource version 1 always exists.
    const third = downgradeApiVersion(requested, maxApiVersion, true);
    if (third === first || third === second) throw e;
    return send(third);
  }
}

interface IssuingClient {
  _issueRequest(url: string, apiVersion: string, params: unknown): Promise<unknown>;
}

/** Routes every request of a REST client through {@link withApiVersion}. */
export function negotiateApiVersion<T>(client: T): T {
  const c = client as unknown as Partial<IssuingClient>;
  const issue = c._issueRequest;
  if (typeof issue === "function") {
    c._issueRequest = (url, apiVersion, params) => withApiVersion(apiVersion, (v) => issue.call(client, url, v, params));
  }
  return client;
}

/** Raw `fetch` against the collection with the extension's access token and version negotiation. */
export async function apiFetch(path: string, apiVersion: string, init: RequestInit = {}): Promise<Response> {
  const base = /^https?:\/\//i.test(path) ? "" : await collectionUrl();
  return withApiVersion(apiVersion, async (version) => {
    const url = `${base}${path}${path.includes("?") ? "&" : "?"}api-version=${version}`;
    const send = async (rejected: boolean) => {
      const token = await getFreshAccessToken(rejected);
      return fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    };
    let res = await send(false);
    if (res.status === 401) res = await send(true);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = `Request failed (${res.status})`;
      try {
        message = JSON.parse(body).message ?? message;
      } catch {
        // Not JSON; keep the generic message.
      }
      throw Object.assign(new Error(message), { status: res.status });
    }
    return res;
  });
}
