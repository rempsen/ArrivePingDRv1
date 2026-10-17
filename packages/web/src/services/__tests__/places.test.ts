import { describe, expect, test } from "bun:test";
import {
  AUTOCOMPLETE_FIELD_MASK,
  DETAILS_FIELD_MASK,
  autocompleteAddress,
  placeDetails,
  validPlaceId,
  validSessionToken,
} from "../places";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Shape recorded from the live smoke check against the new project (2026-10-07). */
const AC_OK = {
  suggestions: [
    {
      placePrediction: {
        placeId: "ChIJ-abc_123",
        text: { text: "423 Main St, Winnipeg, MB, Canada" },
        structuredFormat: { mainText: { text: "423 Main St" }, secondaryText: { text: "Winnipeg, MB, Canada" } },
      },
    },
    // query predictions carry no placeId and are skipped
    { queryPrediction: { text: { text: "423 main pizza" } } },
  ],
};

const TOKEN = "3f1c2a8e-5b7d-4e2f-9a10-6c4d8e2b1f00";

describe("validSessionToken / validPlaceId", () => {
  test("accept UUIDs and URL-safe ids, reject anything else", () => {
    expect(validSessionToken(TOKEN)).toBe(TOKEN);
    expect(validSessionToken("x".repeat(37))).toBeUndefined();
    expect(validSessionToken("has space")).toBeUndefined();
    expect(validSessionToken(undefined)).toBeUndefined();
    expect(validPlaceId("ChIJ-abc_123")).toBe("ChIJ-abc_123");
    expect(validPlaceId("../../v1/other")).toBeUndefined();
    expect(validPlaceId("a?b=c")).toBeUndefined();
  });
});

describe("autocompleteAddress", () => {
  test("posts a Places (New) request with token, CA/US restriction, bias and field mask", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const r = await autocompleteAddress("423 main", {
      key: "k",
      sessionToken: TOKEN,
      bias: { lat: 49.9, lng: -97.1 },
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return json(AC_OK);
      },
    });
    expect(seen!.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(seen!.init!.method).toBe("POST");
    const h = seen!.init!.headers as Record<string, string>;
    expect(h["X-Goog-Api-Key"]).toBe("k");
    expect(h["X-Goog-FieldMask"]).toBe(AUTOCOMPLETE_FIELD_MASK);
    const body = JSON.parse(String(seen!.init!.body));
    expect(body).toEqual({
      input: "423 main",
      includedRegionCodes: ["ca", "us"],
      sessionToken: TOKEN,
      locationBias: { circle: { center: { latitude: 49.9, longitude: -97.1 }, radius: 50_000 } },
    });
    expect(r).toEqual({
      provider: "google",
      predictions: [
        {
          placeId: "ChIJ-abc_123",
          description: "423 Main St, Winnipeg, MB, Canada",
          main: "423 Main St",
          secondary: "Winnipeg, MB, Canada",
        },
      ],
    });
  });

  test("drops an invalid session token and omits bias when there is none", async () => {
    let body: Record<string, unknown> = {};
    await autocompleteAddress("423 main", {
      key: "k",
      sessionToken: "not a token!",
      bias: null,
      fetchImpl: async (_u, init) => {
        body = JSON.parse(String(init!.body));
        return json(AC_OK);
      },
    });
    expect(body.sessionToken).toBeUndefined();
    expect(body.locationBias).toBeUndefined();
  });

  test("short input or no key makes no request", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return json(AC_OK);
    };
    expect((await autocompleteAddress("42", { key: "k", fetchImpl: f })).predictions).toEqual([]);
    expect(await autocompleteAddress("423 main", { key: "", fetchImpl: f })).toEqual({ predictions: [], provider: "none" });
    expect(calls).toBe(0);
  });

  test("a denied key, an error status or a timeout is reported as degraded, not as 'no results'", async () => {
    const denied = await autocompleteAddress("423 main", {
      key: "k",
      fetchImpl: async () => json({ error: { code: 403, status: "PERMISSION_DENIED", message: "API not enabled" } }, 403),
    });
    expect(denied).toEqual({ predictions: [], provider: "google", degraded: true });
    const timedOut = await autocompleteAddress("423 main", {
      key: "k",
      fetchImpl: async () => {
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    expect(timedOut.degraded).toBe(true);
  });
});

describe("placeDetails", () => {
  test("GETs Essentials fields with the session token and parses the location", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const r = await placeDetails("ChIJ-abc_123", {
      key: "k",
      sessionToken: TOKEN,
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return json({ formattedAddress: "423 Main St, Winnipeg, MB R3B 1B3, Canada", location: { latitude: 49.8996, longitude: -97.1385 } });
      },
    });
    expect(seen!.url).toBe(`https://places.googleapis.com/v1/places/ChIJ-abc_123?sessionToken=${TOKEN}`);
    const h = seen!.init!.headers as Record<string, string>;
    expect(h["X-Goog-FieldMask"]).toBe(DETAILS_FIELD_MASK);
    expect(DETAILS_FIELD_MASK).toBe("formattedAddress,location"); // Essentials SKU; don't widen casually
    expect(r).toEqual({ lat: 49.8996, lng: -97.1385, address: "423 Main St, Winnipeg, MB R3B 1B3, Canada", provider: "google" });
  });

  test("rejects a place id that could change the request path, without calling Google", async () => {
    let calls = 0;
    const r = await placeDetails("../../v1/places:searchText", {
      key: "k",
      fetchImpl: async () => {
        calls++;
        return json({});
      },
    });
    expect(calls).toBe(0);
    expect(r.lat).toBeNull();
  });

  test("an error response is degraded with null coordinates", async () => {
    const r = await placeDetails("ChIJ-abc_123", { key: "k", fetchImpl: async () => json({ error: { status: "NOT_FOUND" } }, 404) });
    expect(r).toEqual({ lat: null, lng: null, address: "", provider: "google", degraded: true });
  });
});
