import { beforeEach, describe, expect, it, vi } from "vitest";

const getServiceLocation = vi.fn();
vi.mock("azure-devops-extension-sdk", () => ({
  getAccessToken: async () => "t",
  getHost: () => ({ name: "org", isHosted: false }),
  getService: async () => ({ getServiceLocation })
}));

import { apiFetch, downgradeApiVersion, negotiateApiVersion, parseMaxApiVersion, resetApiVersion, withApiVersion } from "../src/core/api/host";

const OUT_OF_RANGE = "The requested REST API version of 7.2 is out of range for this server. The latest REST API version this server supports is 7.0.";
const versionError = (message = OUT_OF_RANGE) => Object.assign(new Error(message), { status: 400 });

beforeEach(() => resetApiVersion());

describe("API version helpers", () => {
  it("parses the server limit from the out-of-range message", () => {
    expect(parseMaxApiVersion(OUT_OF_RANGE)).toBe("7.0");
    expect(parseMaxApiVersion("Something else")).toBeUndefined();
  });

  it("downgrades only versions above the limit and keeps the preview flag", () => {
    expect(downgradeApiVersion("7.2-preview.3", undefined)).toBe("7.2-preview.3");
    expect(downgradeApiVersion("7.2-preview.3", "7.0")).toBe("7.0-preview.3");
    expect(downgradeApiVersion("7.2-preview.3", "7.0", true)).toBe("7.0-preview.1");
    expect(downgradeApiVersion("7.1", "7.0")).toBe("7.0");
    expect(downgradeApiVersion("6.0-preview.1", "7.0")).toBe("6.0-preview.1");
    expect(downgradeApiVersion("7.2-preview", "7.0")).toBe("7.0-preview.1");
  });
});

describe("withApiVersion", () => {
  it("sends the requested version untouched when the server accepts it (cloud)", async () => {
    const send = vi.fn().mockResolvedValue("ok");
    await expect(withApiVersion("7.2-preview.1", send)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([["7.2-preview.1"]]);
  });

  it("learns the server limit and reuses it for later requests", async () => {
    const send = vi.fn().mockRejectedValueOnce(versionError()).mockResolvedValue("ok");
    await expect(withApiVersion("7.2-preview.2", send)).resolves.toBe("ok");
    expect(send.mock.calls).toEqual([["7.2-preview.2"], ["7.0-preview.2"]]);

    const next = vi.fn().mockResolvedValue("ok");
    await withApiVersion("7.2-preview.1", next);
    expect(next.mock.calls).toEqual([["7.0-preview.1"]]);
  });

  it("falls back to resource version 1 when the server lacks the newer revision", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(versionError())
      .mockRejectedValueOnce(versionError("The requested resource version 3 is not supported"))
      .mockResolvedValue("ok");
    await expect(withApiVersion("7.2-preview.3", send)).resolves.toBe("ok");
    expect(send.mock.calls.map((c) => c[0])).toEqual(["7.2-preview.3", "7.0-preview.3", "7.0-preview.1"]);
  });

  it("does not retry unrelated errors", async () => {
    const send = vi.fn().mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    await expect(withApiVersion("7.2-preview.1", send)).rejects.toThrow("Not found");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("wraps a REST client's request pipeline", async () => {
    const issued: string[] = [];
    const client = {
      _issueRequest: vi.fn(async (_url: string, v: string, _params: unknown) => {
        issued.push(v);
        if (v.startsWith("7.2")) throw versionError();
        return "ok";
      })
    };
    negotiateApiVersion(client);
    await expect(client._issueRequest("u", "7.2-preview.1", {})).resolves.toBe("ok");
    expect(issued).toEqual(["7.2-preview.1", "7.0-preview.1"]);
  });
});

describe("apiFetch", () => {
  it("builds the URL from the collection root reported by the host", async () => {
    getServiceLocation.mockResolvedValue("https://tfs.contoso.local/DefaultCollection");
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiFetch("Proj/_apis/git/repositories/r/pullRequests/1/commits?continuationToken=x", "7.0");
    expect(fetchMock.mock.calls[0][0]).toBe("https://tfs.contoso.local/DefaultCollection/Proj/_apis/git/repositories/r/pullRequests/1/commits?continuationToken=x&api-version=7.0");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
    vi.unstubAllGlobals();
  });
});
