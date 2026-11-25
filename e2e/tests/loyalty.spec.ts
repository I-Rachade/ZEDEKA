import { request as playwrightRequest } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Zedeka+, fidélité et mises en avant : un restaurant paie pour être en tête de liste (badge « Sponsorisé ») ;
// une cliente demande Zedeka+, l'équipe encaisse et l'active, sa livraison de repas devient offerte ; l'équipe lance un
// défi que le livreur retrouve dans son appli.
const API = `http://localhost:${API_PORT}`;
const shots = (name: string) => `test-results/fidelite/${name}.png`;

test("Zedeka+, points, défis livreurs et mises en avant", async ({ page, ip, admin, newRestaurant, newDriver, driverApi, actor }) => {
  test.setTimeout(240_000);
  const restaurant = await newRestaurant();

  await test.step("l'équipe met le restaurant en avant : badge « Sponsorisé » en tête de liste", async () => {
    await admin.post(`/admin/sponsors/${restaurant.id}`, { weeks: 1 });
    const sponsors = await admin.get<{ commerces: { id: string; sponsored: boolean }[]; payments: { amount: number }[] }>("/admin/sponsors");
    expect(sponsors.commerces.find((c) => c.id === restaurant.id)?.sponsored).toBe(true);
    expect(sponsors.payments[0].amount).toBe(5000);
    const list = await (await playwrightRequest.newContext()).get(`${API}/api/restaurants`).then((r) => r.json());
    expect(list.find((r: { slug: string }) => r.slug === restaurant.slug)?.sponsored).toBe(true);
    await page.goto("/app/recherche");
    const card = page.getByRole("link", { name: new RegExp(restaurant.name) }).first();
    await expect(card.getByText("Sponsorisé")).toBeVisible();
  });

  // Cliente avec un compte, connectée dans le navigateur.
  const phone = uniquePhone();
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const { devCode } = await (await ctx.post(`${API}/api/customer/otp/request`, { data: { phone } })).json();
  const login = await (await ctx.post(`${API}/api/customer/otp/verify`, { data: { phone, code: devCode, name: "Akossiwa Mensah", acceptTerms: true } })).json();
  const auth = { authorization: `Bearer ${login.token}` };
  await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token: login.token, ...login.customer });

  await test.step("la cliente voit ses points et demande Zedeka+", async () => {
    await page.goto("/app/fidelite");
    await expect(page.getByText("Mes points")).toBeVisible();
    await page.getByRole("button", { name: "S'abonner à Zedeka+" }).click();
    await expect(page.getByText(/Demande envoyée/)).toBeVisible();
    await page.screenshot({ path: shots("1-client-demande"), fullPage: true });
  });

  const boss = await actor({ desktop: true });
  await test.step("l'équipe encaisse le premier mois et active l'abonnement", async () => {
    await boss.goto("/admin/connexion#secours");
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.goto("/admin/zedeka-plus");
    const request = boss.locator("li", { hasText: "Akossiwa Mensah" }).first();
    await expect(request).toBeVisible();
    await request.getByRole("button", { name: "Activer" }).click();
    await request.getByRole("button", { name: /Encaisser .* et activer/ }).click();
    await expect(boss.getByText(/Abonné jusqu'au/).first()).toBeVisible();
    await boss.screenshot({ path: shots("2-admin-zedeka-plus"), fullPage: true });
  });

  await test.step("la cliente est abonnée ; sa livraison de repas est offerte d'office", async () => {
    await page.goto("/app/fidelite");
    await expect(page.getByText(/Vous êtes abonné jusqu'au/)).toBeVisible();
    await page.screenshot({ path: shots("3-client-abonnee"), fullPage: true });
    const res = await ctx.post(`${API}/api/orders`, {
      headers: auth,
      data: {
        acceptTerms: true,
        restaurantSlug: restaurant.slug,
        customerName: "Akossiwa Mensah",
        customerPhone: phone,
        paymentMethod: "CASH",
        latitude: 6.16,
        longitude: 1.23,
        items: [{ menuItemId: restaurant.items[0].id, quantity: 2 }],
      },
    });
    expect(res.status()).toBe(201);
    // 2 × 2 500 F de plats, livraison offerte : le total est le prix des plats.
    expect((await res.json()).total).toBe(5000);
  });

  await test.step("l'équipe lance un défi que le livreur suit dans son appli", async () => {
    const driver = await newDriver();
    const now = Date.now();
    await admin.post("/admin/challenges", { title: "Défi E2E : 20 livraisons", target: 20, reward: 5000, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 7 * 86_400_000).toISOString() });
    const d = await driverApi(driver);
    const mine = await d.get<{ title: string; done: number; target: number; live: boolean }[]>("/livreur/challenges");
    expect(mine.find((c) => c.title === "Défi E2E : 20 livraisons")).toMatchObject({ done: 0, target: 20, live: true });
    await boss.goto("/admin/defis");
    await expect(boss.getByText("Défi E2E : 20 livraisons").first()).toBeVisible();
    await boss.screenshot({ path: shots("4-admin-defis"), fullPage: true });
    await boss.goto("/admin/mises-en-avant");
    await expect(boss.getByText(restaurant.name).first()).toBeVisible();
    await boss.screenshot({ path: shots("5-admin-mises-en-avant"), fullPage: true });
  });
});
