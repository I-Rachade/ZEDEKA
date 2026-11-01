import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Repas pour quelqu'un d'autre : le client crée un lien, la personne livrée l'ouvre et partage sa position,
// le prix de livraison est calculé sur la distance depuis le restaurant, puis la commande part.

// Tarif repas des réglages par défaut : 500 FCFA minimum, 200 FCFA par km, arrondi aux 50 FCFA.
// 0,036° de latitude au nord du restaurant ≈ 4,0 km, soit 800 FCFA.
const NORTH_4_KM = 0.036;
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("repas pour quelqu'un d'autre : la personne livrée partage sa position", async ({ page, actor, newRestaurant, api }) => {
  test.setTimeout(180_000);
  const restaurant = await newRestaurant();

  await page.goto(`/r/${restaurant.slug}`);
  await page.getByRole("button", { name: "Ajouter Riz au poulet" }).click();
  await page.getByRole("button", { name: "Voir le panier" }).click();
  await page.getByRole("dialog", { name: "Panier" }).getByRole("link", { name: "Commander" }).click();
  await page.getByRole("button", { name: /Continuer sans compte/ }).click();

  let link = "";
  await test.step("le client crée le lien pour la personne livrée", async () => {
    await page.getByLabel("Votre nom").fill("Yawa Dossou");
    await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
    await page.getByRole("button", { name: /Pour quelqu'un d'autre/ }).click();
    await page.getByLabel("Prénom de la personne livrée (facultatif)").fill("Komi");
    await page.getByRole("button", { name: "Créer le lien" }).click();
    link = (await page.locator("span.font-mono", { hasText: "/position/" }).textContent())!.trim();
    expect(link).toContain("/position/");
    await expect(page.getByRole("button", { name: "Indiquez le point de livraison" }).first()).toBeDisabled();
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
    await expect(page.getByText(/Position reçue de la personne livrée/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/4 km du restaurant/)).toBeVisible();
    await expect(page.getByLabel("Repère pour le livreur (facultatif)")).toHaveValue("portail vert");
    await expect(page.locator("aside").getByText(fcfa(800))).toBeVisible();
    await page.getByRole("button", { name: /^Commander/ }).click();
  });

  const code = await createdCode(page);
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ type: "FOOD", status: "PENDING", deliveryFee: 800 });
});
