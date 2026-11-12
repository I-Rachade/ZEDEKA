import { EtagMismatch } from "pmtiles";
import { describe, expect, it } from "vitest";
import { isMapPath, MAP_KEY, R2Source, serveMap } from "./mapTiles.js";

// R2 réduit : un fichier, lectures par plages, condition sur l'etag.
function fakeBucket(bytes: Uint8Array | null, etag = "v1") {
  const gets: unknown[] = [];
  const bucket = {
    async get(key: string, opts: { range: { offset: number; length: number }; onlyIf?: { etagMatches: string } }) {
      gets.push({ key, ...opts });
      if (!bytes) return null;
      if (opts.onlyIf && opts.onlyIf.etagMatches !== etag) return { etag };
      const part = bytes.slice(opts.range.offset, opts.range.offset + opts.range.length);
      return { etag, body: true, arrayBuffer: async () => part.buffer };
    },
  } as unknown as R2Bucket;
  return { bucket, gets };
}

describe("fond de carte", () => {
  it("reconnaît les adresses des tuiles", () => {
    expect(isMapPath("/api/carte/15/16456/15785.mvt")).toBe(true);
    expect(isMapPath("/api/carte/info")).toBe(true);
    expect(isMapPath("/api/carte/../x")).toBe(false);
    expect(isMapPath("/api/carte/15/a/1.mvt")).toBe(false);
  });

  it("lit R2 par plages et signale un fichier remplacé", async () => {
    const { bucket, gets } = fakeBucket(new Uint8Array([1, 2, 3, 4, 5]));
    const src = new R2Source(bucket, MAP_KEY);
    const r = await src.getBytes(1, 3);
    expect([...new Uint8Array(r.data)]).toEqual([2, 3, 4]);
    expect(r.etag).toBe("v1");
    expect(gets[0]).toMatchObject({ key: MAP_KEY, range: { offset: 1, length: 3 } });
    await expect(src.getBytes(0, 2, undefined, "ancien")).rejects.toBeInstanceOf(EtagMismatch);
  });

  it("sans carte dans R2 : le site garde OpenStreetMap", async () => {
    const { bucket } = fakeBucket(null);
    const info = await serveMap(new Request("https://api/api/carte/info"), bucket);
    expect(await info.json()).toEqual({ available: false });
    expect((await serveMap(new Request("https://api/api/carte/14/8228/7892.mvt"), bucket)).status).toBe(503);
    expect((await serveMap(new Request("https://api/api/carte/3/9/1.mvt"), bucket)).status).toBe(404);
  });
});
