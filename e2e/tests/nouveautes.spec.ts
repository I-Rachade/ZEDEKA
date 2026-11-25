import { readFileSync } from "node:fs";
import { request as playwrightRequest } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Onglet « Nouveautés » : l'équipe publie une courte vidéo verticale reliée à un plat ; le client la voit en
// plein écran, l'aime, la commente, et « Commander » ouvre directement la fiche du plat sur la carte.

const API = `http://localhost:${API_PORT}/api`;
const shots = (name: string) => `test-results/nouveautes/${name}.png`;
// WebM : le Chromium des tests ne lit pas le H.264 des MP4 (les téléphones lisent les deux).
const VIDEO = { name: "nouveaute-riz.webm", mimeType: "video/webm", buffer: readFileSync(new URL("./assets/nouveaute-riz.webm", import.meta.url)) };

test("nouveautés : vidéo publiée par l'équipe, aimée, commentée et commandée par le client", async ({ page, ip, newRestaurant, actor }) => {
  test.setTimeout(240_000);
  const restaurant = await newRestaurant();
  const dish = restaurant.items[0];

  const boss = await actor({ desktop: true });
  await test.step("le directeur publie une vidéo reliée au plat", async () => {
    await boss.goto("/admin/connexion#secours");
    await expect(boss.getByLabel("Adresse e-mail")).toBeHidden();
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.getByRole("link", { name: "Nouveautés" }).click();
    await expect(boss).toHaveURL(/\/admin\/nouveautes$/);

    const form = boss.locator("form").filter({ has: boss.locator('input[type="file"]') }).first();
    await form.locator('input[type="file"]').setInputFiles(VIDEO);
    await expect(form.getByText("Changer la vidéo")).toBeVisible({ timeout: 30_000 });
    await expect(form.getByText(/Vidéo : 6 s, 540 × 960 px\. Format parfait\./)).toBeVisible();
    await form.getByLabel(/Nom du produit/).fill(dish.name);
    await form.getByLabel(/Texte court/).fill("Nouveau ! Braisé au feu de bois");
    await form.getByPlaceholder(/Chercher un plat/).fill(restaurant.name);
    await form.getByRole("button", { name: new RegExp(dish.name) }).first().click();
    await expect(form.getByText(new RegExp(`Plat · ${dish.name}`))).toBeVisible();
    await form.screenshot({ path: shots("4-admin-nouvelle-video") });
    await form.getByRole("button", { name: "Publier la vidéo" }).click();
    await expect(boss.getByText("En ligne").first()).toBeVisible();
  });

  await test.step("l'onglet Nouveautés remplace Recherche ; la vidéo joue en plein écran", async () => {
    await page.goto("/app");
    const tabs = page.getByRole("navigation").last();
    await expect(tabs.getByRole("link", { name: "Nouveautés" })).toBeVisible();
    await expect(tabs.getByRole("link", { name: "Recherche" })).toHaveCount(0);
    await page.screenshot({ path: shots("1-barre-onglets") });
    await tabs.getByRole("link", { name: "Nouveautés" }).click();
    await expect(page).toHaveURL(/\/app\/nouveautes$/);
    const slide = page.getByRole("region", { name: dish.name }).or(page.locator(`section[aria-label="${dish.name}"]`)).first();
    await expect(slide).toBeVisible();
    await expect(slide.getByText("Nouveau ! Braisé au feu de bois")).toBeVisible();
    await expect(slide.getByRole("button", { name: /Commander/ })).toBeVisible();
    // La vidéo joue d'elle-même.
    await expect.poll(() => slide.locator("video").evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.3);
    await page.screenshot({ path: shots("2-fil-video") });
  });

  await test.step("sans compte, « J'aime » propose de se connecter", async () => {
    await page.getByRole("button", { name: "J'aime" }).first().click();
    await expect(page.getByRole("dialog", { name: /Connectez-vous pour aimer/ })).toBeVisible();
    await page.getByRole("button", { name: "Plus tard" }).click();
  });

  // Compte client (code SMS affiché en mode test), session posée sur l'appareil comme après la connexion.
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const phone = uniquePhone();
  const { devCode } = await (await ctx.post(`${API}/customer/otp/request`, { data: { phone } })).json();
  const session = await (await ctx.post(`${API}/customer/otp/verify`, { data: { phone, code: devCode, name: "Ama Kpodar", acceptTerms: true } })).json();
  await page.evaluate((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token: session.token, ...session.customer, hasPin: true });

  await test.step("connectée, la cliente aime et commente", async () => {
    await page.reload();
    const like = page.getByRole("button", { name: "J'aime" }).first();
    await like.click();
    await expect(page.getByRole("button", { name: "Je n'aime plus" }).first()).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Commentaires" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Commentaires" });
    await expect(sheet.getByText("Soyez le premier à commenter.")).toBeVisible();
    await sheet.getByLabel("Votre commentaire").fill("Ça a l'air délicieux, j'en commande deux !");
    await sheet.getByRole("button", { name: "Envoyer" }).click();
    await expect(sheet.getByText("Ça a l'air délicieux, j'en commande deux !")).toBeVisible();
    await expect(sheet.getByText("Ama K.")).toBeVisible();
    await page.screenshot({ path: shots("3-commentaires") });
    await sheet.getByRole("button", { name: "Fermer" }).last().click();
    // Le « j'aime » est gardé côté serveur.
    const feed = await (await ctx.get(`${API}/reels`, { headers: { authorization: `Bearer ${session.token}` } })).json();
    expect(feed.reels[0]).toMatchObject({ liked: true, likeCount: 1, commentCount: 1 });
  });

  await test.step("« Commander » ouvre la fiche du plat sur la carte du restaurant", async () => {
    await page.getByRole("button", { name: /Commander/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/r/${restaurant.slug}\\?plat=${dish.id}`));
    await expect(page.getByRole("dialog").getByText(dish.name).first()).toBeVisible();
    await page.waitForTimeout(600);
    await page.screenshot({ path: shots("5-fiche-plat") });
  });

  await ctx.dispose();
});
