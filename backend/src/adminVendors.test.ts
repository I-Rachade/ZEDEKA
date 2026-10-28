import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sendUpload, slugify } from "./routes/adminVendors.js";
import { claimInto } from "./routes/adminFinance.js";
import { HttpError } from "./routes/adminWrite.js";
import { memoryStore } from "./storage.js";

describe("lien d'un partenaire validé", () => {
  it("retire accents et ponctuation", () => {
    expect(slugify("Chez Tante Ama")).toBe("chez-tante-ama");
    expect(slugify("Pâtisserie l'Étoile d'Or !")).toBe("patisserie-l-etoile-d-or");
    expect(slugify("!!!")).toBe("partenaire");
  });
});

describe("fichiers des candidatures", () => {
  const files = memoryStore();
  files.files.set("vendor-applications/ZP-1/logo.png", { body: new Uint8Array([1, 2, 3]), contentType: "image/png" });
  files.files.set("secrets/cle.txt", { body: new Uint8Array([9]), contentType: "text/plain" });
  const app = express();
  app.get("/", async (req, res) => {
    await sendUpload(res, files, (req.query.key as string) ?? null);
  });

  it("sert un fichier de candidature avec son type", async () => {
    const res = await request(app).get("/").query({ key: "vendor-applications/ZP-1/logo.png" }).expect(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect([...res.body]).toEqual([1, 2, 3]);
  });

  it("ne sert rien d'autre", async () => {
    for (const key of ["secrets/cle.txt", "vendor-applications/../secrets/cle.txt", "vendor-applications/ZP-2/logo.png", ""]) {
      await request(app).get("/").query({ key }).expect(404);
    }
  });
});

describe("relevés sans transaction (claimInto)", () => {
  // Une petite base en mémoire : des commandes libres ou rattachées à un relevé.
  function store(ids: string[]) {
    const orders = new Map(ids.map((id) => [id, null as string | null]));
    const records = new Map<string, number>();
    let n = 0;
    const run = () =>
      claimInto(
        async () => [...orders].filter(([, r]) => r === null).map(([id]) => ({ id })),
        "Rien à encaisser",
        async () => {
          const id = `r${++n}`;
          records.set(id, 0);
          return { id, count: 0 };
        },
        async (ids, recordId) => {
          let count = 0;
          for (const id of ids) {
            if (orders.get(id) === null) {
              orders.set(id, recordId);
              count++;
            }
          }
          return { count };
        },
        async (recordId) => {
          const count = [...orders.values()].filter((r) => r === recordId).length;
          records.set(recordId, count);
          return { id: recordId, count };
        },
        async (recordId) => records.delete(recordId),
      );
    return { orders, records, run };
  }

  it("rattache les commandes libres et calcule le relevé sur elles", async () => {
    const s = store(["a", "b"]);
    expect(await s.run()).toEqual({ id: "r1", count: 2 });
    await expect(s.run()).rejects.toMatchObject({ status: 400 });
  });

  it("deux clics en même temps : un seul relevé garde les commandes, l'autre est supprimé", async () => {
    const s = store(["a", "b", "c"]);
    const results = await Promise.allSettled([s.run(), s.run()]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused[0].reason).toBeInstanceOf(HttpError);
    expect(refused[0].reason.status).toBe(409);
    expect([...s.records]).toEqual([["r1", 3]]);
    expect(new Set(s.orders.values())).toEqual(new Set(["r1"]));
  });
});
