import { request as playwrightRequest } from "@playwright/test";
import { API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Appli marchand : une boutique en ligne crée son profil, envoie deux colis d'un coup (l'un saisi, l'autre collé
// depuis une liste), avec contre-remboursement. Le livreur livre et encaisse, la boutique voit son solde, et le
// directeur enregistre le reversement.

const API = `http://localhost:${API_PORT}/api`;
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("marchand : boutique, envoi groupé avec contre-remboursement, livraison et reversement", async ({ page, ip, admin, newDriver, driverApi }) => {
  test.setTimeout(180_000);
  const phone = uniquePhone();
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const call = async <T>(method: string, path: string, token?: string, data?: unknown): Promise<T> => {
    const res = await ctx.fetch(`${API}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, data });
    expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  };

  // Compte client (code SMS affiché en mode test), session posée sur l'appareil comme après la connexion.
  const { devCode } = await call<{ devCode: string }>("POST", "/customer/otp/request", undefined, { phone });
  const session = await call<{ token: string; customer: { phone: string; name: string | null } }>("POST", "/customer/otp/verify", undefined, { phone, code: devCode, name: "Ama Kpodar", acceptTerms: true });
  const token = session.token;
  await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token, ...session.customer, hasPin: true });

  await test.step("première visite : création de la boutique", async () => {
    await page.goto("/marchand");
    await expect(page).toHaveURL(/\/marchand\/boutique$/);
    await page.getByLabel("Nom de la boutique").fill("Ama Fashion");
    await page.getByLabel("Adresse et repère").fill("Tokoin Wuiti, face à la station");
    await page.getByRole("checkbox", { name: /J'accepte les/ }).check();
    await page.getByRole("button", { name: "Créer ma boutique" }).click();
    await expect(page).toHaveURL(/\/marchand$/);
    await expect(page.getByRole("heading", { name: "Ama Fashion" })).toBeVisible();
    // Position du point de ramassage (la carte n'est pas jouée ici).
    await call("PATCH", "/marchand/me", token, { pickupLatitude: 6.13, pickupLongitude: 1.22 });
  });

  await test.step("envoi groupé : un colis saisi, un autre collé depuis une liste", async () => {
    await page.goto("/marchand/envoyer");
    const first = page.getByRole("region", { name: "Colis 1" });
    await first.getByLabel("Nom du client").fill("Afi Mensah");
    await first.getByLabel("Téléphone du client").fill(uniquePhone());
    await first.getByPlaceholder("0 : déjà payé").fill("15000");

    await page.getByRole("button", { name: "Coller une liste" }).click();
    await page.getByLabel("Liste des clients").fill(`Kossi Agbo ; ${uniquePhone()} ; Bè Kpota, portail bleu ; 8000 ; #1042`);
    await page.getByRole("button", { name: "Ajouter" }).click();
    const second = page.getByRole("region", { name: "Colis 2" });
    await expect(second.getByLabel("Nom du client")).toHaveValue("Kossi Agbo");
    await expect(second.getByLabel("Adresse et repère")).toHaveValue("Bè Kpota, portail bleu");
    // Le prix de chaque ligne s'affiche avant de valider.
    await expect(second.getByText("Le livreur encaisse")).toBeVisible();

    await page.getByRole("button", { name: "Envoyer les 2 colis" }).click();
    await expect(page.getByRole("heading", { name: "2 colis envoyés" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Demander sa position sur WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/228\d{8}\?text=.*position/);
    await expect(page.getByRole("link", { name: "Envoyer le suivi sur WhatsApp" })).toBeVisible();
  });

  const parcels = await call<{ id: string; code: string; recipientName: string; total: number; fees: number; codAmount: number }[]>("GET", "/marchand/parcels?filter=open", token);
  expect(parcels).toHaveLength(2);
  const kossi = parcels.find((p) => p.recipientName === "Kossi Agbo")!;
  // La boutique paie la livraison : le livreur n'encaisse que les articles.
  expect(kossi.total).toBe(8000);
  expect(kossi.codAmount).toBe(8000);

  await test.step("la répartition confie le colis, le livreur le ramasse et le livre en encaissant", async () => {
    const driver = await newDriver({ online: true });
    const zones = await admin.get<{ id: string }[]>("/admin/zones");
    await admin.patch(`/admin/orders/${kossi.id}`, { zoneId: zones[0].id, driverId: driver.id });
    const drv = await driverApi(driver);
    const current = await drv.get<{ offers: { id: string; order: { cashDue: number } }[] }>("/livreur/current");
    expect(current.offers[0].order.cashDue).toBe(8000);
    await drv.post(`/livreur/assignments/${current.offers[0].id}/accept`);
    await drv.post(`/livreur/orders/${kossi.id}/status`, { status: "PICKED_UP" });
    const detail = await call<{ deliveryCode: string }>("GET", `/marchand/parcels/${kossi.code}`, token);
    expect(detail.deliveryCode).toMatch(/^\d{4}$/);
    await drv.post(`/livreur/orders/${kossi.id}/status`, { status: "DELIVERED", cashCollected: 8000, code: detail.deliveryCode });
  });

  const net = 8000 - kossi.fees;
  await test.step("la boutique voit son solde, le directeur reverse", async () => {
    await page.goto("/marchand/argent");
    await expect(page.getByText(fcfa(net)).first()).toBeVisible();
    await expect(page.getByText("Kossi Agbo")).toBeVisible();

    const merchants = await admin.get<{ id: string; shopName: string; balance: number }[]>("/admin/merchants");
    const shop = merchants.find((m) => m.shopName === "Ama Fashion" && m.balance === net)!;
    expect(shop).toBeTruthy();
    const payout = await admin.post<{ amount: number; orderCount: number }>("/admin/finance/merchant-payouts", { merchantId: shop.id });
    expect(payout).toMatchObject({ amount: net, orderCount: 1 });

    await page.reload();
    await expect(page.getByText("Rien en attente.")).toBeVisible();
    await expect(page.getByRole("list").getByText(fcfa(net))).toBeVisible();
  });

  await ctx.dispose();
});
