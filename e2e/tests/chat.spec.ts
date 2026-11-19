import { request as playwrightRequest } from "@playwright/test";
import { API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Messagerie client ↔ livreur : dès que le livreur a accepté la course, le client lui écrit depuis le suivi,
// le livreur répond depuis sa course ; après la livraison, la conversation reste lisible (archive) et
// l'équipe la retrouve dans le détail de la commande.
const PICKUP = { latitude: 6.13, longitude: 1.22 };
const DROP = { latitude: 6.16, longitude: 1.22 };
const API = `http://localhost:${API_PORT}`;
const SHOTS = process.env.E2E_SHOTS;

test("messagerie : le client et le livreur s'écrivent, la conversation est archivée", async ({ page, ip, admin, api, newDriver, driverApi, actor }) => {
  test.setTimeout(180_000);
  const zones = await admin.get<{ id: string }[]>("/admin/zones");
  const categories = await api.get<{ id: string }[]>("/parcel-categories");

  // Client avec un compte (code SMS de développement), connecté dans le navigateur.
  const phone = uniquePhone();
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const { devCode } = await (await ctx.post(`${API}/api/customer/otp/request`, { data: { phone } })).json();
  const login = await (await ctx.post(`${API}/api/customer/otp/verify`, { data: { phone, code: devCode, name: "Afi Lawson", acceptTerms: true } })).json();
  const parcelRes = await ctx.post(`${API}/api/parcels`, {
    headers: { authorization: `Bearer ${login.token}` },
    data: {
      acceptTerms: true,
      zoneId: zones[0].id,
      customerName: "Afi Lawson",
      customerPhone: phone,
      paymentMethod: "CASH",
      pickupAddress: "Bè, Lomé",
      pickupLatitude: PICKUP.latitude,
      pickupLongitude: PICKUP.longitude,
      address: "Adidogomé, Lomé",
      ...DROP,
      recipientName: "Kossi Agbo",
      recipientPhone: uniquePhone(),
      parcelCategoryId: categories[0].id,
      weightKg: 1,
    },
  });
  expect(parcelRes.ok()).toBe(true);
  const { code } = await parcelRes.json();
  await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token: login.token, ...login.customer });

  const driver = await newDriver({ online: true });
  const d = await driverApi(driver);

  await test.step("pas de conversation tant que le livreur n'a pas accepté", async () => {
    await page.goto(`/commande/${code}`);
    await expect(page.getByText("Suivi du colis").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^Écrire à/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^WhatsApp avec/ })).toHaveCount(0);
  });

  await test.step("la répartition confie le colis, le livreur accepte", async () => {
    const list = await admin.get<{ id: string; code: string }[] | { orders: { id: string; code: string }[] }>(`/admin/orders?q=${code}`);
    const id = (Array.isArray(list) ? list : list.orders).find((o) => o.code === code)!.id;
    await admin.patch(`/admin/orders/${id}`, { driverId: driver.id });
    const cur = await d.get("/livreur/current");
    const offer = cur.offers.find((o: { order: { code: string } }) => o.order.code === code);
    await d.post(`/livreur/assignments/${offer.id}/accept`);
  });

  const driverFirst = driver.name.split(" ")[0];
  await test.step("le client peut joindre le livreur sur WhatsApp pendant la course", async () => {
    await page.reload();
    const wa = page.getByRole("link", { name: new RegExp(`^WhatsApp avec ${driverFirst}`) });
    await expect(wa).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\d*${driver.phone.replace(/\D/g, "").slice(-8)}\\?text=`));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/7-suivi-whatsapp.png`, fullPage: true });
    // La page de suivi ouverte avec le seul code (lien partagé, autre appareil) ne montre ni le fil ni le numéro.
    const stranger = await actor();
    await stranger.goto(`/commande/${code}`);
    await expect(stranger.getByText("Suivi du colis").first()).toBeVisible();
    await expect(stranger.getByRole("link", { name: /^WhatsApp avec/ })).toHaveCount(0);
    await expect(stranger.getByText(driver.phone.replace(/\D/g, "").slice(-8))).toHaveCount(0);
  });

  await test.step("le client écrit au livreur depuis le suivi", async () => {
    await page.reload();
    const open = page.getByRole("button", { name: new RegExp(`^Écrire à ${driverFirst}`) });
    await expect(open).toBeVisible();
    await open.click();
    const chat = page.getByRole("dialog");
    await chat.getByRole("button", { name: "Je suis devant le portail." }).click();
    await chat.getByLabel("Votre message").fill("Le portail bleu, à côté de la boutique.");
    await chat.getByRole("button", { name: "Envoyer" }).click();
    await expect(chat.getByText("Le portail bleu, à côté de la boutique.")).toBeVisible();
  });

  const app = await actor({ geolocation: PICKUP });
  await test.step("le livreur lit et répond depuis sa course", async () => {
    await app.goto("/livreur/connexion");
    await app.getByLabel("Numéro de téléphone").fill(driver.phone);
    await app.getByLabel("Code PIN").fill(driver.pin);
    await app.getByRole("button", { name: "Se connecter" }).click();
    await app.getByText(code).first().click();
    const open = app.getByRole("button", { name: /^Écrire au client/ });
    await expect(open).toContainText("2 message(s) non lu(s)");
    await open.click();
    const chat = app.getByRole("dialog");
    await expect(chat.getByText("Le portail bleu, à côté de la boutique.")).toBeVisible();
    await chat.getByRole("button", { name: "J'arrive dans 5 minutes." }).click();
    await expect(chat.getByText("J'arrive dans 5 minutes.")).toBeVisible();
    if (SHOTS) await app.screenshot({ path: `${SHOTS}/2-livreur-conversation.png` });
  });

  await test.step("la réponse arrive chez le client, ses messages sont marqués « Lu »", async () => {
    const chat = page.getByRole("dialog");
    await expect(chat.getByText("J'arrive dans 5 minutes.")).toBeVisible({ timeout: 15_000 });
    await expect(chat.getByText(/· Lu$/).first()).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-client-conversation.png` });
    await chat.getByRole("button", { name: "Fermer" }).click();
    // Accès par l'icône en haut de l'accueil (à côté de la cloche) et par le menu du compte.
    await page.goto("/app/profil");
    await expect(page.getByRole("link", { name: "Messages" })).toHaveAttribute("href", "/app/messages");
    await page.goto("/app");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/6-accueil-icone-messages.png` });
    await page.locator("header").first().getByRole("link", { name: /^Messages/ }).click();
    await expect(page).toHaveURL(/\/app\/messages$/);
    await expect(page.getByRole("link", { name: new RegExp(driverFirst) })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-client-messages-actifs.png` });
  });

  await test.step("après la livraison : conversation archivée, lisible par l'équipe", async () => {
    const list = await admin.get<{ id: string; code: string }[] | { orders: { id: string; code: string }[] }>(`/admin/orders?q=${code}`);
    const id = (Array.isArray(list) ? list : list.orders).find((o) => o.code === code)!.id;
    await admin.patch(`/admin/orders/${id}`, { status: "PICKED_UP" });
    await admin.patch(`/admin/orders/${id}`, { status: "DELIVERED" });
    await page.reload();
    await expect(page.getByRole("tab", { name: "Actifs" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Aucune conversation")).toBeVisible();
    await page.getByRole("tab", { name: "Archives" }).click();
    await expect(page.getByRole("tab", { name: "Archives" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("link", { name: new RegExp(driverFirst) })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-client-messages-archives.png` });
    await page.getByRole("link", { name: new RegExp(driverFirst) }).click();
    const chat = page.getByRole("dialog");
    await expect(chat.getByText("Conversation archivée : la livraison est terminée.")).toBeVisible();
    await expect(chat.getByLabel("Votre message")).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-client-archive.png` });
    // Livraison terminée : plus de WhatsApp sur le suivi.
    await page.goto(`/commande/${code}`);
    await expect(page.getByRole("button", { name: new RegExp(`^Écrire à ${driverFirst}`) })).toBeVisible();
    await expect(page.getByRole("link", { name: /^WhatsApp avec/ })).toHaveCount(0);

    const detail = await admin.get<{ messages: { from: string; body: string }[] }>(`/admin/orders/${id}`);
    expect(detail.messages.map((m) => m.from)).toEqual(["CUSTOMER", "CUSTOMER", "DRIVER"]);
    await expect(d.post(`/livreur/orders/${id}/chat`, { body: "Encore là ?" })).rejects.toThrow(/409/);
  });
  // Hors ligne : la répartition automatique des tests suivants ne lui propose plus rien.
  await d.patch("/livreur/online", { online: false });
  await ctx.dispose();
});
