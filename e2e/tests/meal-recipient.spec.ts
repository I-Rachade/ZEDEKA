import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Repas pour quelqu'un d'autre : le client crée un lien, la personne livrée l'ouvre et partage sa position,
// le prix de livraison est calculé sur la distance depuis le restaurant, puis la commande part.

// Grille de prix des réglages (27/11/2026) : 500 FCFA jusqu'à 5 km, 1 000 FCFA jusqu'à 10 km, 1 500 FCFA au-delà.
// 0,036° de latitude au nord du restaurant ≈ 4,0 km, soit 500 FCFA.
const NORTH_4_KM = 0.036;
// Montant exact : « 500 FCFA » ne doit pas trouver « 2 500 FCFA ».
const exactFcfa = (n: number) => new RegExp(`^${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA$`);

test("repas pour quelqu'un d'autre : la personne livrée partage sa position", async ({ page, actor, newRestaurant, api }) => {
  test.setTimeout(180_000);
  const restaurant = await newRestaurant();

  await page.goto(`/r/${restaurant.slug}`);
  await page.getByRole("button", { name: "Ajouter Riz au poulet" }).click();
  await page.getByRole("link", { name: /^Commander · 1 article\(s\)/ }).click();

  let link = "";
  await test.step("le client crée le lien pour la personne livrée", async () => {
    await page.getByRole("button", { name: /Pour quelqu'un d'autre/ }).click();
    await page.getByRole("button", { name: /Lui demander sa position/ }).click();
    await page.getByLabel("Votre nom (il apparaît dans le message)").fill("Yawa Dossou");
    await page.getByLabel("Prénom de la personne livrée (facultatif)").fill("Komi");
    await page.getByRole("button", { name: "Créer le lien" }).click();
    link = (await page.locator("span.font-mono", { hasText: "/position/" }).textContent())!.trim();
    expect(link).toContain("/position/");
  });

  await test.step("la personne livrée ouvre le lien et envoie sa position", async () => {
    const recipient = await actor({ geolocation: { latitude: restaurant.latitude + NORTH_4_KM, longitude: restaurant.longitude } });
    await recipient.goto(new URL(link).pathname);
    await expect(recipient.getByRole("heading", { name: "Yawa vous fait livrer un repas" })).toBeVisible();
    await recipient.getByRole("button", { name: "Partager ma position" }).click();
    await recipient.getByLabel("Repère pour le livreur (facultatif)").fill("portail vert");
    await recipient.getByRole("button", { name: "Envoyer ma position" }).click();
    await expect(recipient.getByRole("heading", { name: "Position envoyée, merci" })).toBeVisible();
  });

  await test.step("la position arrive à la caisse, fixe le prix, et la commande part", async () => {
    await expect(page.getByText(/Position reçue de la personne livrée/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("4 km du restaurant", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Repère pour le livreur (facultatif)")).toHaveValue("portail vert");
    // Le nom est déjà rempli ; il reste le téléphone.
    await expect(page.getByLabel("Votre nom")).toHaveValue("Yawa Dossou");
    await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
    await expect(page.locator("aside").getByText(exactFcfa(500))).toBeVisible();
    await page.getByRole("button", { name: /^Commander/ }).click();
    await expect(page.getByRole("heading", { name: "C'est commandé !" })).toBeVisible();
  });

  const code = await createdCode(page);
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ type: "FOOD", status: "PENDING", deliveryFee: 500 });
});
