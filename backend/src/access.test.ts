import express from "express";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_HEADER, adminAccess, requireAccess, resetAccessKeyCache, verifyAccessJwt, type AccessConfig } from "./access.js";

// L'admin derrière Cloudflare Access : le jeton est vérifié par nous, pas cru sur parole.

const TEAM = "https://zedeka-test.cloudflareaccess.com";
const AUD = "aud-admin-test";
const CFG: AccessConfig = { teamDomain: TEAM, aud: AUD };
const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

let key: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let jwk: JsonWebKey;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const part = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function token(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}, signer: CryptoKey = key.privateKey, now = NOW) {
  const seconds = Math.floor(now / 1000);
  const head = part({ alg: "RS256", kid: "k1", typ: "JWT", ...header });
  const body = part({ aud: [AUD], iss: TEAM, sub: "user-1", email: "rachadeissaka@gmail.com", iat: seconds, nbf: seconds, exp: seconds + 3600, ...claims });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

function certs() {
  return vi.fn(async () => Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  key = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
});

beforeEach(() => resetAccessKeyCache());
afterEach(() => vi.restoreAllMocks());

describe("réglages Access", () => {
  it("demande le domaine et l'AUD, avec ou sans https://, et lit la liste d'adresses", () => {
    expect(adminAccess({}).config).toBeNull();
    expect(adminAccess({ ACCESS_TEAM_DOMAIN: TEAM }).config).toBeNull();
    expect(adminAccess({ ACCESS_TEAM_DOMAIN: "zedeka-test.cloudflareaccess.com/", ACCESS_AUD: ` ${AUD} ` }).config).toEqual(CFG);
    const access = adminAccess({ ADMIN_ACCESS_REQUIRED: "1", ADMIN_EMAILS: " RachadeIssaka@gmail.com , " });
    expect(access.required).toBe(true);
    expect(access.emails).toEqual(["rachadeissaka@gmail.com"]);
    expect(adminAccess({ ADMIN_ACCESS_REQUIRED: "true" }).required).toBe(false);
  });
});

describe("vérification du jeton Access", () => {
  it("accepte un jeton signé par l'équipe pour notre application", async () => {
    expect(await verifyAccessJwt(await token(), CFG, certs(), NOW)).toEqual({ email: "rachadeissaka@gmail.com", sub: "user-1" });
  });

  it("refuse une autre application, une autre équipe et un jeton hors de sa période", async () => {
    const seconds = NOW / 1000;
    for (const claims of [{ aud: ["autre"] }, { iss: "https://evil.cloudflareaccess.com" }, { exp: seconds - 120 }, { exp: undefined }, { nbf: seconds + 600 }]) {
      expect(await verifyAccessJwt(await token(claims), CFG, certs(), NOW)).toBeNull();
    }
  });

  it("refuse une mauvaise signature, alg none, une clé inconnue et n'importe quoi", async () => {
    expect(await verifyAccessJwt(await token({}, {}, otherKey.privateKey), CFG, certs(), NOW)).toBeNull();
    const [head, body] = (await token()).split(".");
    expect(await verifyAccessJwt(`${part({ alg: "none", kid: "k1" })}.${body}.`, CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({}, { kid: "k2" }), CFG, certs(), NOW)).toBeNull();
    const forged = (await token()).split(".");
    forged[1] = part({ aud: [AUD], iss: TEAM, sub: "user-2", email: "intrus@example.com", exp: NOW / 1000 + 3600 });
    expect(await verifyAccessJwt(forged.join("."), CFG, certs(), NOW)).toBeNull();
    for (const junk of ["", "a.b", "a.b.c", `${head}.${body}`]) expect(await verifyAccessJwt(junk, CFG, certs(), NOW)).toBeNull();
  });

  it("garde les clés un moment et refuse si elles sont introuvables", async () => {
    const fetcher = certs();
    await verifyAccessJwt(await token(), CFG, fetcher, NOW);
    await verifyAccessJwt(await token(), CFG, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resetAccessKeyCache();
    const down = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    expect(await verifyAccessJwt(await token(), CFG, down, NOW)).toBeNull();
  });
});

describe("requireAccess devant l'admin", () => {
  function app(env: Parameters<typeof adminAccess>[0]) {
    const a = express();
    a.use(requireAccess(adminAccess(env), certs()));
    a.get("/", (_req, res) => {
      res.json({ ok: true });
    });
    return a;
  }
  const on = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_ACCESS_REQUIRED: "1" };

  it("ne change rien tant que l'interrupteur est éteint", async () => {
    await request(app({})).get("/").expect(200);
  });

  it("interrupteur allumé : il faut un jeton valide, et une adresse de la liste si elle est remplie", async () => {
    // Le jeton est daté de maintenant : le middleware vérifie à l'heure réelle.
    const valid = await token({}, {}, key.privateKey, Date.now());
    await request(app(on)).get("/").expect(403);
    await request(app(on)).get("/").set(ACCESS_HEADER, "abc").expect(403);
    await request(app(on)).get("/").set(ACCESS_HEADER, valid).expect(200);
    await request(app({ ...on, ADMIN_EMAILS: "rachadeissaka@gmail.com" })).get("/").set(ACCESS_HEADER, valid).expect(200);
    await request(app({ ...on, ADMIN_EMAILS: "autre@example.com" })).get("/").set(ACCESS_HEADER, valid).expect(403);
  });

  it("reste fermé si l'interrupteur est allumé sans réglages Access", async () => {
    const valid = await token({}, {}, key.privateKey, Date.now());
    await request(app({ ADMIN_ACCESS_REQUIRED: "1" })).get("/").set(ACCESS_HEADER, valid).expect(403);
  });
});
