import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { request as playwrightRequest } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Boutiques en ligne (étape 1) : le module « Boutiques » est coupé par défaut ; le directeur l'annonce
// (« Bientôt »), un marchand ajoute ses produits, ses bannières (image et vidéo en carrousel) et demande la mise
// en ligne ; l'équipe refuse un produit, accepte les autres, choisit la facturation et met la boutique en ligne.
// Le marchand voit ensuite sa boutique telle que les clients la verront.

const API = `http://localhost:${API_PORT}/api`;
const shots = (name: string) => `test-results/boutiques/${name}.png`;
const VIDEO = new URL("./assets/pub-boutique.webm", import.meta.url);

// Captures propres : sans le badge de next dev, une fois la page chargée.
async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(300);
}

// Photo de produit fabriquée dans le navigateur : fond de couleur et grand emoji, en JPEG.
async function photo(page: Page, emoji: string, colors: [string, string], size: [number, number] = [800, 800], text = ""): Promise<Buffer> {
  const p = await page.context().newPage();
  await p.setViewportSize({ width: size[0], height: size[1] });
  await p.setContent(
    `<body style="margin:0"><div style="width:${size[0]}px;height:${size[1]}px;background:linear-gradient(135deg,${colors[0]},${colors[1]});display:flex;align-items:center;justify-content:${text ? "space-between" : "center"};padding:0 80px;box-sizing:border-box;font-family:sans-serif;color:#fff">${text ? `<div style="font-size:84px;font-weight:800;line-height:1.05">${text}</div>` : ""}<div style="font-size:${Math.round(size[1] * 0.55)}px">${emoji}</div></div></body>`,
  );
  const shot = await p.screenshot({ type: "jpeg", quality: 85 });
  await p.close();
  return shot;
}

test("boutiques en ligne : module coupé par défaut, catalogue, bannières, validation par l'équipe", async ({ page, ip, admin, actor }) => {
  test.setTimeout(300_000);
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const call = async <T>(method: string, path: string, token?: string, data?: unknown, raw?: { body: Buffer; type: string }): Promise<{ status: number; body: T }> => {
    const res = await ctx.fetch(`${API}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(raw ? { "content-type": raw.type } : {}) },
      ...(raw ? { data: raw.body } : { data }),
    });
    return { status: res.status(), body: (await res.json().catch(() => null)) as T };
  };
  const ok = async <T>(method: string, path: string, token?: string, data?: unknown, raw?: { body: Buffer; type: string }) => {
    const r = await call<T>(method, path, token, data, raw);
    expect(r.status, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`).toBeLessThan(300);
    return r.body;
  };

  // Compte client et boutique du marchand, préparés par l'API (la création de la boutique a son propre test).
  const phone = uniquePhone();
  const { devCode } = await ok<{ devCode: string }>("POST", "/customer/otp/request", undefined, { phone });
  const session = await ok<{ token: string; customer: { phone: string; name: string | null } }>("POST", "/customer/otp/verify", undefined, { phone, code: devCode, name: "Awa Mensah", acceptTerms: true });
  const token = session.token;
  const merchant = await ok<{ id: string }>("POST", "/marchand/me", token, { shopName: "Awa Couture", phone, pickupAddress: "Akpakpa, rue du marché", pickupLatitude: 6.13, pickupLongitude: 1.22, acceptTerms: true });
  await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token, ...session.customer, hasPin: true });

  await test.step("module coupé par défaut : rien pour les marchands, l'API refuse le catalogue", async () => {
    await admin.patch("/admin/services/SHOP", { state: "OFF" });
    expect((await ok<{ module: string; store: unknown }>("GET", "/marchand/store", token)).store).toBeNull();
    expect((await call("POST", "/marchand/products", token, { name: "Test", price: 1000, stock: 1, imageUrls: ["https://exemple.com/a.jpg"] })).status).toBe(403);
    await page.goto("/marchand");
    await expect(page.getByRole("heading", { name: "Awa Couture" })).toBeVisible();
    await expect(page.getByText("Vendre en ligne")).toHaveCount(0);
  });

  const boss = await actor({ desktop: true });
  await boss.setViewportSize({ width: 1280, height: 1100 });
  await test.step("le directeur annonce le module « Boutiques » (Bientôt)", async () => {
    await boss.goto("/admin/connexion");
    await boss.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.goto("/admin/services");
    const group = boss.getByRole("radiogroup", { name: "État de Boutiques" });
    // La vente aux clients n'est pas encore construite : « Ouvert » reste fermé.
    await expect(group.getByRole("radio", { name: "Ouvert" })).toBeDisabled();
    await group.getByRole("radio", { name: "Bientôt" }).click();
    await expect(group.getByRole("radio", { name: "Bientôt" })).toHaveAttribute("aria-checked", "true");
    await settle(boss);
    await group.scrollIntoViewIfNeeded();
    await boss.screenshot({ path: shots("01-admin-module-boutiques") });
  });

  await test.step("le marchand voit « Vendre en ligne » et ajoute un produit avec photo, tailles et couleurs", async () => {
    await page.goto("/marchand");
    await expect(page.getByText("Vendre en ligne")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: shots("02-marchand-accueil") });
    await page.getByText("Vendre en ligne").click();
    await expect(page).toHaveURL(/\/marchand\/produits$/);
    await expect(page.getByText("Aucun produit pour l'instant")).toBeVisible();

    await page.getByRole("link", { name: "Ajouter" }).click();
    await expect(page).toHaveURL(/\/marchand\/produits\/nouveau$/);
    await page.getByLabel("Ajouter des photos").setInputFiles({ name: "robe.jpg", mimeType: "image/jpeg", buffer: await photo(page, "👗", ["#f4d6ff", "#c084fc"]) });
    await expect(page.getByRole("img", { name: "Photo 1" })).toBeVisible();
    await page.getByLabel("Nom du produit").fill("Robe wax longue");
    await page.getByLabel("Prix (FCFA)").fill("12500");
    await page.getByLabel("Stock").fill("4");
    await page.getByLabel("Rayon de la boutique").fill("Robes");
    await page.getByLabel("Description").fill("Coton wax, coupe droite. Lavable à 30°.");
    await page.getByRole("button", { name: "Ajouter un choix" }).click();
    await page.getByLabel("Valeurs du choix 1").fill("S, M, L, XL");
    await page.getByRole("button", { name: "Ajouter un choix" }).click();
    await page.getByLabel("Valeurs du choix 2").fill("Bleu, Rouge");
    await settle(page);
    await page.screenshot({ path: shots("03-marchand-nouveau-produit"), fullPage: true });
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page).toHaveURL(/\/marchand\/produits$/);
    await expect(page.getByText("Robe wax longue")).toBeVisible();
  });

  // Autres produits par l'API, chacun avec sa photo envoyée comme depuis le téléphone.
  const more: [string, number, number, string, string, [string, string]][] = [
    ["Pagne 6 yards", 8000, 15, "Pagnes", "🧣", ["#fff1cc", "#ffb020"]],
    ["Sac en raphia", 6500, 2, "Sacs", "👜", ["#dbeafe", "#60a5fa"]],
    ["Sandales en cuir", 9000, 0, "Chaussures", "👡", ["#fde4e0", "#e0503a"]],
    ["Boubou homme brodé", 15000, 6, "Robes", "👘", ["#dff3e8", "#0e7c4a"]],
    ["Foulard de tête", 3500, 20, "Pagnes", "🎀", ["#fce7f3", "#ec4899"]],
  ];
  const ids: string[] = [];
  for (const [name, price, stock, section, emoji, colors] of more) {
    const { url } = await ok<{ url: string }>("POST", "/marchand/store/images", token, undefined, { body: await photo(page, emoji, colors), type: "image/jpeg" });
    ids.push((await ok<{ id: string }>("POST", "/marchand/products", token, { name, price, stock, section, imageUrls: [url] })).id);
  }

  await test.step("bannières : une image et une vidéo publicitaires en carrousel", async () => {
    await page.goto("/marchand/bannieres");
    await page.getByLabel("Ajouter une image").setInputFiles({
      name: "promo.jpg",
      mimeType: "image/jpeg",
      buffer: await photo(page, "🛍️", ["#0e7c4a", "#0a5a36"], [1600, 700], "Nouvelle<br>collection"),
    });
    await expect(page.getByText("Bannière 1")).toBeVisible();
    await page.getByLabel("Texte de la bannière 1").fill("Arrivage de la semaine");
    await page.getByLabel("Texte de la bannière 1").blur();
    await page.getByLabel("Produit ouvert au toucher").first().selectOption({ label: "Ouvre : Robe wax longue" });
    await page.getByLabel("Ajouter une vidéo").setInputFiles({ name: "pub.webm", mimeType: "video/webm", buffer: readFileSync(VIDEO) });
    await expect(page.getByText("Bannière 2")).toBeVisible({ timeout: 30_000 });
    await settle(page);
    await page.screenshot({ path: shots("04-marchand-bannieres"), fullPage: true });
    const banners = await ok<{ kind: string; url: string }[]>("GET", "/marchand/banners", token);
    expect(banners.map((b) => b.kind)).toEqual(["IMAGE", "VIDEO"]);
    // La vidéo se lit par morceaux, comme sur un téléphone.
    const part = await ctx.fetch(banners[1].url, { headers: { range: "bytes=0-99" } });
    expect(part.status()).toBe(206);
    expect((await part.body()).length).toBe(100);
  });

  await test.step("présentation et demande de mise en ligne", async () => {
    await page.goto("/marchand/vente");
    await page.getByRole("radio", { name: /Mode/ }).click();
    await page.getByLabel("Description courte").fill("Mode femme, pagnes et sacs faits main à Akpakpa.");
    await page.getByLabel("N° de pièce d'identité ou IFU").fill("IFU 3201912345678");
    await settle(page);
    await page.screenshot({ path: shots("05-marchand-demande"), fullPage: true });
    await page.getByRole("button", { name: "Demander la mise en ligne" }).click();
    await expect(page).toHaveURL(/\/marchand\/produits$/);
    await expect(page.getByText("En vérification")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: shots("06-marchand-produits-en-verification"), fullPage: true });
  });

  await test.step("l'équipe refuse un produit, accepte les autres et met la boutique en ligne avec 10 % de commission", async () => {
    await boss.goto("/admin/marchands?onglet=vente");
    const row = boss.getByRole("link", { name: "Awa Couture" }).first();
    await expect(row).toBeVisible();
    await settle(boss);
    await boss.screenshot({ path: shots("07-admin-vente-en-ligne") });
    await row.click();
    await expect(boss.getByText("IFU 3201912345678")).toBeVisible();
    await settle(boss);
    await boss.screenshot({ path: shots("08-admin-boutique-a-valider"), fullPage: true });

    const sandals = boss.getByRole("listitem").filter({ hasText: "Sandales en cuir" });
    await sandals.getByRole("button", { name: "Refuser" }).click();
    await sandals.getByLabel("Motif du refus").fill("Photo trop sombre : montrez les sandales en entier.");
    await sandals.getByRole("button", { name: "Refuser" }).click();
    await expect(sandals.getByText("Refusé")).toBeVisible();
    await boss.getByRole("button", { name: /Tout accepter/ }).click();
    await expect(boss.getByRole("button", { name: /Tout accepter/ })).toHaveCount(0);

    await boss.getByLabel("Taux de commission (%)").fill("10");
    await boss.getByRole("button", { name: "Mettre en ligne" }).click();
    await expect(boss.getByText("Validée").first()).toBeVisible();
    await settle(boss);
    await boss.screenshot({ path: shots("09-admin-boutique-en-ligne"), fullPage: true });

    // Abonnement à la place de la commission, comme pour un restaurant.
    await boss.getByRole("radio", { name: "Abonnement mensuel" }).check();
    await boss.getByLabel("Abonnement mensuel (FCFA)").fill("15000");
    await boss.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(async () => (await admin.get(`/admin/stores/${merchant.id}`)).billing).toEqual({ mode: "SUBSCRIPTION", rate: 0, fee: 15000 });
    await boss.getByRole("radio", { name: "Commission par vente" }).check();
    await boss.getByLabel("Taux de commission (%)").fill("10");
    await boss.getByRole("button", { name: "Enregistrer" }).click();
  });

  await test.step("le marchand voit sa boutique validée, le produit refusé et l'aperçu client", async () => {
    await page.goto("/marchand/produits");
    await expect(page.getByText("Validée")).toBeVisible();
    await expect(page.getByText("Photo trop sombre")).toBeVisible();
    await settle(page);
    await page.screenshot({ path: shots("10-marchand-boutique-validee"), fullPage: true });

    await page.goto("/marchand/apercu");
    await expect(page.getByRole("heading", { name: /Awa Couture/ })).toBeVisible();
    await expect(page.getByText("Robe wax longue")).toBeVisible();
    // Le produit refusé n'apparaît pas aux clients.
    await expect(page.getByText("Sandales en cuir")).toHaveCount(0);
    await settle(page);
    await page.screenshot({ path: shots("11-apercu-boutique-client") });
    await page.screenshot({ path: shots("12-apercu-boutique-client-page"), fullPage: true });
    // La bannière mène au produit.
    await page.getByRole("button", { name: /Arrivage de la semaine/ }).click();
    const sheet = page.getByRole("dialog", { name: "Robe wax longue" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "M", exact: true }).click();
    await settle(page);
    await page.screenshot({ path: shots("13-apercu-fiche-produit") });
    await sheet.getByRole("button", { name: "Fermer" }).click();

    // La vidéo est la deuxième bannière du carrousel.
    await page.locator('[aria-roledescription="carousel"]').evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shots("14-apercu-banniere-video") });
  });

  await ctx.dispose();
});
