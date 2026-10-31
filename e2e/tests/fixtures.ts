import { test as base, devices, expect, request as playwrightRequest, type APIRequestContext, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";

// Outils communs : identifiants uniques, appels directs à l'API (admin, restaurant, livreur) pour préparer
// les données, et une adresse IP par test pour ne pas buter sur les limites de l'API (src/rateLimit.ts).

export { expect };

const API = `http://localhost:${API_PORT}`;
let counter = 0;

// Suffixe unique par appel : les tests partagent une base et ne doivent pas se marcher dessus.
export function uid(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// Numéro togolais à 8 chiffres, unique : « 9X XX XX XX ».
export function uniquePhone(): string {
  const digits = `${Date.now() % 1_000_000}${counter++ % 10}`.padStart(7, "0").slice(-7);
  return `9${digits}`.replace(/^(\d{2})(\d{2})(\d{2})(\d{2})$/, "$1 $2 $3 $4");
}

const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;

export type Api = {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
  patch<T = any>(path: string, body?: unknown): Promise<T>;
  put<T = any>(path: string, body?: unknown): Promise<T>;
};

function client(ctx: APIRequestContext, token?: string): Api {
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await ctx.fetch(`${API}/api${path}`, {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      data: body,
    });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${method} ${path} → ${res.status()} ${text}`);
    return text ? JSON.parse(text) : null;
  };
  return {
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b ?? {}),
    patch: (p, b) => call("PATCH", p, b ?? {}),
    put: (p, b) => call("PUT", p, b ?? {}),
  };
}

export type Restaurant = {
  id: string;
  slug: string;
  name: string;
  email: string;
  password: string;
  latitude: number;
  longitude: number;
  items: { id: string; name: string; price: number }[];
};

export type Driver = { id: string; name: string; phone: string; pin: string };
// Code PIN de départ donné par l'admin à chaque livreur de test.
const DRIVER_PIN = "4826";

type Fixtures = {
  // Adresse IP fictive propre au test, envoyée par le navigateur et par les appels directs.
  ip: string;
  api: Api;
  admin: Api;
  newRestaurant: (opts?: { latitude?: number; longitude?: number }) => Promise<Restaurant>;
  newDriver: (opts?: { employment?: "FREELANCE" | "STAFF"; online?: boolean }) => Promise<Driver>;
  // Jeton d'un espace (restaurant, livreur) obtenu par l'API, pour faire avancer une commande sans l'interface.
  restaurantApi: (r: Restaurant) => Promise<Api>;
  driverApi: (d: Driver) => Promise<Api>;
  // Autre personne dans son propre navigateur (restaurant, répartition, livreur, destinataire).
  // desktop : écran d'ordinateur (espace restaurant, admin) ; sinon téléphone comme le test principal.
  actor: (opts?: { desktop?: boolean; geolocation?: { latitude: number; longitude: number } }) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  ip: async ({}, use) => use(fakeIp()),
  extraHTTPHeaders: async ({ ip }, use) => use({ "cf-connecting-ip": ip }),

  api: async ({ ip }, use) => {
    const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
    await use(client(ctx));
    await ctx.dispose();
  },

  admin: async ({ ip }, use) => {
    const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
    const { token } = await client(ctx).post<{ token: string }>("/admin/login", { password: ADMIN_PASSWORD });
    await use(client(ctx, token));
    await ctx.dispose();
  },

  newRestaurant: async ({ admin }, use) => {
    await use(async (opts = {}) => {
      const id = uid();
      const zones = await admin.get<{ id: string; name: string }[]>("/admin/zones");
      const latitude = opts.latitude ?? 6.1475;
      const longitude = opts.longitude ?? 1.2125;
      const r = await admin.post<{ id: string; slug: string; name: string }>("/admin/restaurants", {
        slug: `e2e-${id}`,
        name: `Maquis E2E ${id}`,
        phone: "22890000099",
        address: "Tokoin, Lomé",
        zoneId: zones[0].id,
        latitude,
        longitude,
      });
      const menu = [
        { category: "Plats", name: "Riz au poulet", price: 2500 },
        { category: "Plats", name: "Fufu sauce graine", price: 2000 },
        { category: "Boissons", name: "Jus de bissap", price: 500 },
      ];
      const items = [];
      for (const [i, m] of menu.entries()) items.push(await admin.post(`/admin/restaurants/${r.id}/items`, { ...m, sortOrder: i }));
      const email = `${r.slug}@e2e.zedeka.tg`;
      const password = "e2e-restaurant-pass";
      await admin.put(`/admin/restaurants/${r.id}/access`, { email, password });
      return { ...r, email, password, latitude, longitude, items };
    });
  },

  newDriver: async ({ admin }, use) => {
    await use(async (opts = {}) => {
      const name = `Livreur ${uid()}`;
      const phone = uniquePhone();
      const zones = await admin.get<{ id: string }[]>("/admin/zones");
      const d = await admin.post<{ id: string }>("/admin/drivers", {
        name,
        phone: `+228${phone.replace(/\s/g, "")}`,
        zoneId: zones[0].id,
        online: opts.online ?? false,
        employment: opts.employment ?? "FREELANCE",
        ...(opts.employment === "STAFF" ? { monthlySalary: 60000 } : {}),
        pin: DRIVER_PIN,
      });
      return { id: d.id, name, phone, pin: DRIVER_PIN };
    });
  },

  actor: async ({ browser, baseURL, ip }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (opts = {}) => {
      const device = opts.desktop ? devices["Desktop Chrome"] : devices["Pixel 7"];
      const context = await browser.newContext({
        ...device,
        baseURL,
        locale: "fr-FR",
        timezoneId: "Africa/Lome",
        extraHTTPHeaders: { "cf-connecting-ip": ip },
        ...(opts.geolocation ? { geolocation: opts.geolocation, permissions: ["geolocation"] } : {}),
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },

  restaurantApi: async ({ ip }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (r) => {
      const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
      contexts.push(ctx);
      const { token } = await client(ctx).post<{ token: string }>("/restaurant/login", { email: r.email, password: r.password });
      return client(ctx, token);
    });
    for (const c of contexts) await c.dispose();
  },

  driverApi: async ({ ip }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (d) => {
      const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
      contexts.push(ctx);
      const api = client(ctx);
      const { devCode } = await api.post<{ devCode: string }>("/livreur/otp/request", { phone: d.phone });
      const { token } = await api.post<{ token: string }>("/livreur/otp/verify", { phone: d.phone, code: devCode });
      return client(ctx, token);
    });
    for (const c of contexts) await c.dispose();
  },
});

// Code de suivi affiché après une commande (repas ou colis).
export async function createdCode(page: Page): Promise<string> {
  const code = (await page.getByText("Votre code de suivi").locator("..").locator("p.font-mono").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z0-9-]{4,}$/);
  return code;
}
