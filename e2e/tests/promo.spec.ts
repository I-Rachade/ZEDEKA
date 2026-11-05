import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Code promo : l'admin crée une offre mise en avant, le client l'active depuis « Offres pour vous », la caisse
// l'applique toute seule et l'API enregistre la remise ; la page Promotions compte l'utilisation.

const NORTH_6_KM = 0.054;
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("code promo activé sur l'accueil puis appliqué à la caisse", async ({ page, context, newRestaurant, admin, api }) => {
  test.setTimeout(180_000);
  const restaurant = await newRestaurant();
  const code = `ZED${Date.now().toString(36).slice(-5).toUpperCase()}`;
  await admin.post("/admin/promos", {
    code,
    title: "-20 % sur toute la commande",
    kind: "PERCENT",
    value: 20,
    maxDiscount: 2000,
    minSubtotal: 3000,
    restaurantId: restaurant.id,
    payer: "ZEDEKA",
    showOnHome: true,
  });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: restaurant.latitude + NORTH_6_KM, longitude: restaurant.longitude });

  await test.step("le client active l'offre sur l'accueil", async () => {
    await page.goto("/app");
    const card = page.locator("div").filter({ hasText: code }).filter({ has: page.getByRole("link", { name: "Activer" }) }).last();
    await expect(card).toBeVisible();
    await card.getByRole("link", { name: "Activer" }).click();
    await expect(page).toHaveURL(new RegExp(`/r/${restaurant.slug}`));
  });

  let orderCode = "";
  await test.step("la caisse applique le code", async () => {
    await page.getByRole("button", { name: "Ajouter Riz au poulet" }).click();
    await page.getByRole("button", { name: "Ajouter Jus de bissap" }).click();
    await page.getByRole("button", { name: "Ajouter encore Jus de bissap (1 dans le panier)" }).click();
    await page.getByRole("button", { name: "Voir le panier" }).click();
    await page.getByRole("dialog", { name: "Panier" }).getByRole("link", { name: "Commander" }).click();
    await page.getByRole("button", { name: /Continuer sans compte/ }).click();
    await page.getByRole("button", { name: /Ma position actuelle/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByLabel("Votre nom").fill("Afi Promo");
    await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
    await page.getByRole("button", { name: "Continuer" }).click();

    // 3 500 de plats, -20 % = -700, livraison 900 : total 3 700.
    const summary = page.locator("aside");
    await expect(summary.getByText("✓ Appliqué")).toBeVisible();
    await expect(summary.getByText(`Promo ${code}`)).toBeVisible();
    await expect(summary.getByText(fcfa(3700))).toBeVisible();
    await page.getByRole("checkbox", { name: /J'accepte les/ }).check();
    await page.getByRole("button", { name: /^Commander/ }).click();
    await expect(page.getByRole("heading", { name: "Commande enregistrée" })).toBeVisible();
    orderCode = await createdCode(page);
  });

  const order = await api.get(`/orders/${orderCode}`);
  expect(order).toMatchObject({ subtotal: 3500, deliveryFee: 900, discount: 700, total: 3700 });

  await test.step("l'admin voit l'utilisation", async () => {
    const promos = await admin.get<{ promos: { code: string; uses: number }[] }>("/admin/promos");
    expect(promos.promos.find((p) => p.code === code)?.uses).toBe(1);
  });
});
