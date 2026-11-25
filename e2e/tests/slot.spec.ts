import { request as playwrightRequest } from "@playwright/test";
import { API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Réservation de créneau : un colis à retrait programmé dans 1 h 30 est proposé tout de suite (moins de 2 h avant)
// au livreur le plus proche, en réservation (3 min pour répondre). Accepté, il reste libre : une course normale lui
// est proposée juste après. Il voit le retrait dans « Mes retraits programmés » et peut se désister (plus d'1 h avant).
const PICKUP = { latitude: 6.13, longitude: 1.22 };
const DROP = { latitude: 6.16, longitude: 1.22 };
const API = `http://localhost:${API_PORT}`;

test("retrait programmé : réservé à l'avance, le livreur reste libre et peut se désister", async ({ admin, api, newDriver, driverApi, actor }) => {
  test.setTimeout(120_000);
  const zones = await admin.get<{ id: string }[]>("/admin/zones");
  const categories = await api.get<{ id: string }[]>("/parcel-categories");
  const cron = await playwrightRequest.newContext();
  const tick = async () => expect((await cron.get(`${API}/cdn-cgi/handler/scheduled`)).ok()).toBe(true);

  const parcel = (pickupAt?: Date) =>
    api.post<{ code: string; id?: string }>("/parcels", {
      acceptTerms: true,
      zoneId: zones[0].id,
      customerName: "Afi Lawson",
      customerPhone: uniquePhone(),
      paymentMethod: "CASH",
      pickupAddress: "Bè, Lomé",
      ...{ pickupLatitude: PICKUP.latitude, pickupLongitude: PICKUP.longitude },
      address: "Adidogomé, Lomé",
      ...DROP,
      recipientName: "Kossi Agbo",
      recipientPhone: uniquePhone(),
      parcelCategoryId: categories[0].id,
      weightKg: 1,
      ...(pickupAt ? { pickupAt: pickupAt.toISOString() } : {}),
    });

  await admin.put("/admin/dispatch/auto", { enabled: true });
  try {
    const driver = await newDriver({ online: true });
    const d = await driverApi(driver);
    await d.post("/livreur/location", PICKUP);

    const at = new Date(Date.now() + 90 * 60_000);
    at.setUTCSeconds(0, 0);
    const slot = await parcel(at);

    let offerId = "";
    await test.step("proposé tout de suite en réservation, 3 min pour répondre", async () => {
      await expect
        .poll(async () => {
          await tick();
          const cur = await d.get("/livreur/current");
          const offer = cur.offers.find((o: { order: { code: string } }) => o.order.code === slot.code);
          offerId = offer?.id ?? "";
          return offer ? { slot: offer.slot, seconds: Math.round((new Date(offer.expiresAt).getTime() - Date.now()) / 1000) > 120 } : null;
        }, { timeout: 30_000 })
        .toEqual({ slot: true, seconds: true });
    });

    await test.step("accepté : rangé dans les retraits programmés, pas dans la course en cours", async () => {
      const r = await d.post(`/livreur/assignments/${offerId}/accept`);
      expect(r.slot).toBe(true);
      const cur = await d.get("/livreur/current");
      expect(cur.active.map((o: { code: string }) => o.code)).not.toContain(slot.code);
      expect(cur.scheduled.map((o: { code: string }) => o.code)).toContain(slot.code);
      const track = await api.get(`/orders/${slot.code}`);
      expect(track.driverReserved).toBe(true);
    });

    await test.step("toujours libre : une course normale lui est proposée", async () => {
      const now = await parcel();
      let id = "";
      await expect
        .poll(async () => {
          await tick();
          const cur = await d.get("/livreur/current");
          id = cur.offers.find((o: { order: { code: string }; slot: boolean }) => o.order.code === now.code && !o.slot)?.id ?? "";
          return !!id;
        }, { timeout: 30_000 })
        .toBe(true);
      // Refusée ici pour que l'écran d'alerte ne couvre pas la suite.
      await d.post(`/livreur/assignments/${id}/reject`, { reason: "Test terminé" });
    });

    await test.step("l'appli montre le retrait programmé avec « Je confirme » et « Me désister »", async () => {
      const page = await actor();
      await page.goto("/livreur/connexion");
      await page.getByLabel("Numéro de téléphone").fill(driver.phone);
      await page.getByLabel("Code PIN").fill(driver.pin);
      await page.getByRole("button", { name: "Se connecter" }).click();
      const section = page.getByRole("region", { name: "Mes retraits programmés" });
      await expect(section).toBeVisible({ timeout: 20_000 });
      await expect(section.getByText(slot.code)).toBeVisible();
      await expect(section.getByRole("button", { name: "Je confirme" })).toBeVisible();
      await expect(section.getByRole("button", { name: "Me désister" })).toBeVisible();
    });

    await test.step("désistement plus d'1 h avant : la course redevient libre", async () => {
      const cur = await d.get("/livreur/current");
      const id = cur.scheduled.find((o: { code: string }) => o.code === slot.code).id;
      await d.post(`/livreur/orders/${id}/slot/release`);
      const after = await d.get("/livreur/current");
      expect(after.scheduled.map((o: { code: string }) => o.code)).not.toContain(slot.code);
      const dispatch = await admin.get("/admin/dispatch");
      const row = dispatch.scheduled.find((o: { code: string }) => o.code === slot.code);
      expect(row.driver).toBeNull();
    });
  } finally {
    await admin.put("/admin/dispatch/auto", { enabled: false });
    await cron.dispose();
  }
});
