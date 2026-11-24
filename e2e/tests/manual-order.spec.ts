import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Saisie au back-office : une cliente commande par WhatsApp, l'équipe enregistre la livraison de repas dans l'admin.
// Le restaurant la reçoit comme une commande de l'appli ; la commande garde le canal et qui l'a saisie.
// Puis un colis demandé par téléphone, enregistré de la même façon.
test("l'équipe saisit une livraison de repas et un colis demandés par WhatsApp et par téléphone", async ({ actor, newRestaurant, restaurantApi }) => {
  const restaurant = await newRestaurant();
  const page = await actor({ desktop: true });
  await page.goto("/admin/connexion#secours");
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/commandes");
  await page.getByRole("link", { name: "Nouvelle commande" }).click();
  await expect(page).toHaveURL(/\/admin\/commandes\/nouvelle$/);

  // Livraison de repas, demandée sur WhatsApp.
  await page.getByRole("button", { name: /Livraison de repas/ }).click();
  await page.getByRole("button", { name: "WhatsApp", exact: true }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Akossiwa Repas");
  await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
  await page.getByLabel("Restaurant ou boutique").selectOption({ label: restaurant.name });
  await page.getByLabel("Plat à ajouter").selectOption({ label: "Plats · Riz au poulet · 2 500 FCFA" });
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Quantité").fill("2");
  await page.getByRole("button", { name: "Placer sur la carte", exact: true }).click();
  await page.getByRole("button", { name: "Valider ce point" }).click();
  await page.getByLabel("Adresse ou repère").fill("Bè, maison jaune");
  await page.getByRole("button", { name: "Calculer le prix" }).click();
  await expect(page.getByText(/^Total .*Plats 5\s000/)).toBeVisible();
  await page.screenshot({ path: "test-results/saisie-repas.png", fullPage: true });
  await page.getByRole("button", { name: "Enregistrer" }).click();

  const done = page.getByText(/Commande .+ enregistrée/);
  await expect(done).toBeVisible();
  await expect(page.getByRole("link", { name: "Envoyer sur WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\//);
  const code = (await done.textContent())!.match(/Commande (\S+) enregistrée/)![1];

  // Le restaurant la reçoit, à accepter comme une commande de l'appli.
  const resto = await restaurantApi(restaurant);
  const orders = await resto.get<{ code: string; status: string }[]>("/restaurant/orders");
  expect(orders.find((o) => o.code === code)?.status).toBe("PENDING");

  await page.getByRole("link", { name: "Voir la commande" }).click();
  await expect(page.getByText(/WhatsApp \(saisie par Directeur des opérations\)/)).toBeVisible();

  // Colis demandé par téléphone.
  await page.goto("/admin/commandes/nouvelle");
  await page.getByRole("button", { name: /Envoi de colis/ }).click();
  await page.getByRole("button", { name: "Téléphone", exact: true }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Kodjo Colis");
  await page.getByLabel("Téléphone", { exact: true }).fill(uniquePhone());
  await page.getByLabel("Adresse du retrait").fill("Grand marché, boutique 4");
  await page.getByLabel("Nom du destinataire").fill("Yawa");
  await page.getByLabel("Téléphone du destinataire").fill(uniquePhone());
  await page.getByLabel("Adresse de livraison").fill("Agoè, près de la station");
  await page.getByLabel("Type de colis").selectOption({ index: 1 });
  await page.screenshot({ path: "test-results/saisie-colis.png", fullPage: true });
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Commande .+ enregistrée/)).toBeVisible();

  // La liste montre le canal sous le code.
  await page.goto("/admin/commandes");
  await expect(page.getByText("Téléphone", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("WhatsApp", { exact: true }).first()).toBeVisible();
});
