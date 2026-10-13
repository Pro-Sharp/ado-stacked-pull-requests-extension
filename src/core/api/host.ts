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
  const base = await collectionUrl();
  return withApiVersion(apiVersion, async (version) => {
    const token = await SDK.getAccessToken();
    const url = `${base}${path}${path.includes("?") ? "&" : "?"}api-version=${version}`;
    const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
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
