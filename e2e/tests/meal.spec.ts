import { ADMIN_PASSWORD } from "../env.mjs";
import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Commande de repas complète : le client commande sans compte avec sa position (prix au km),
// le restaurant accepte et prépare, la répartition affecte un livreur, le livreur récupère et livre,
// le client voit « Livrée » sur son suivi.

// Tarif repas des réglages par défaut : 500 FCFA minimum, 200 FCFA par km, arrondi aux 50 FCFA.
// 0,054° de latitude au nord du restaurant ≈ 6,0 km, soit 1 200 FCFA (différent des tarifs fixes des zones).
const NORTH_6_KM = 0.054;
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("commande repas avec prix à la distance, du panier à la livraison", async ({ page, context, newRestaurant, newDriver, actor, api }) => {
  test.setTimeout(240_000);
  const restaurant = await newRestaurant();
  const driver = await newDriver({ online: true });
  const customer = { name: "Kossi Agbeko", phone: uniquePhone() };
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: restaurant.latitude + NORTH_6_KM, longitude: restaurant.longitude });

  let code = "";
  await test.step("le client remplit son panier et commande", async () => {
    await page.goto(`/r/${restaurant.slug}`);
    await page.getByRole("button", { name: "Ajouter Riz au poulet" }).click();
    await page.getByRole("button", { name: "Ajouter Jus de bissap" }).click();
    await page.getByRole("button", { name: "Ajouter encore Jus de bissap (1 dans le panier)" }).click();
    await page.getByRole("button", { name: "Voir le panier" }).click();
    const cart = page.getByRole("dialog", { name: "Panier" });
    await expect(cart.getByText(fcfa(3500))).toBeVisible();
    await cart.getByRole("link", { name: "Commander" }).click();

    await page.getByRole("button", { name: /Continuer sans compte/ }).click();
    await page.getByLabel("Zone").selectOption({ index: 1 });
    await page.getByLabel("Adresse et repère").fill("Agoè, derrière la pharmacie du marché");
    await page.getByRole("button", { name: /Partager ma position/ }).click();
    await expect(page.getByRole("button", { name: "Position enregistrée ✓" })).toBeVisible();

    // Livraison calculée sur la distance depuis le restaurant, pas sur le tarif de la zone.
    await expect(page.getByText("Livraison (6 km)")).toBeVisible();
    const summary = page.locator("aside");
    await expect(summary.getByText(fcfa(1200))).toBeVisible();
    await expect(summary.getByText(fcfa(4700))).toBeVisible();

    await page.getByLabel("Votre nom").fill(customer.name);
    await page.getByLabel("Téléphone", { exact: true }).fill(customer.phone);
    await page.getByRole("button", { name: /^Commander/ }).click();

    await expect(page.getByRole("heading", { name: "Commande enregistrée" })).toBeVisible();
    code = await createdCode(page);
  });

  // L'API a recalculé le même prix que la page.
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ status: "PENDING", subtotal: 3500, deliveryFee: 1200, total: 4700 });

  await test.step("le restaurant accepte, prépare et signale « prête »", async () => {
    const panel = await actor({ desktop: true });
    await panel.goto("/restaurant/connexion");
    await panel.getByPlaceholder("E-mail").fill(restaurant.email);
    await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
    await panel.getByRole("button", { name: "Se connecter" }).click();

    // Alarme plein écran pour la nouvelle commande.
    await panel.getByRole("button", { name: "Voir" }).click();
    await panel.getByRole("row").filter({ hasText: code }).click();
    await expect(panel.getByRole("heading", { name: `Commande ${code}` })).toBeVisible();
    // Avec un temps de préparation, « Accepter » lance directement la préparation.
    await panel.getByRole("button", { name: "20 min" }).click();
    await panel.getByRole("button", { name: "Accepter" }).first().click();
    await expect(panel.getByText("Préparation annoncée : 20 min")).toBeVisible();
    await panel.getByRole("button", { name: "Commande prête" }).first().click();
    await expect.poll(async () => (await api.get(`/orders/${code}`)).status).toBe("READY");
  });

  await test.step("la répartition affecte le livreur", async () => {
    const dispatch = await actor({ desktop: true });
    await dispatch.goto("/admin/connexion");
    await dispatch.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await dispatch.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await dispatch.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(dispatch).toHaveURL(/\/admin$/);
    await dispatch.goto("/admin/dispatch");
    await dispatch.getByLabel(`Livreur pour ${code}`).selectOption(driver.id);
    await expect(dispatch.getByText(`Envoyée à ${driver.name}, en attente de réponse`)).toBeVisible();
  });

  await test.step("le livreur accepte, récupère et livre en encaissant les espèces", async () => {
    const app = await actor({ geolocation: { latitude: restaurant.latitude, longitude: restaurant.longitude } });
    await app.goto("/livreur/connexion");
    await app.getByLabel("Numéro de téléphone").fill(driver.phone);
    await app.getByRole("button", { name: "Recevoir le code" }).click();
    const devCode = (await app.getByText(/Mode test/).locator("strong").textContent())!.trim();
    await app.getByLabel("Code à 6 chiffres").fill(devCode);
    await app.getByRole("button", { name: "Valider" }).click();

    const offer = app.getByRole("alertdialog", { name: `Nouvelle course ${code}` });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await offer.getByRole("button", { name: "Glisser pour accepter" }).press("Enter");

    await app.getByText(code).first().click();
    // Les boutons à glisser se valident aussi au clavier (Entrée), une fois actifs.
    const pickedUp = app.getByRole("button", { name: "Glisser : commande récupérée" });
    await expect(pickedUp).toHaveAttribute("aria-disabled", "false");
    await pickedUp.press("Enter");
    const delivered = app.getByRole("button", { name: "Glisser : commande livrée" });
    await expect(delivered).toHaveAttribute("aria-disabled", "false");
    await delivered.press("Enter");
    const cash = app.getByRole("dialog");
    await expect(cash.getByLabel("Montant reçu")).toHaveValue("4700");
    await cash.getByRole("button", { name: "Remise faite, le client confirmera" }).click();
    await expect(app.getByRole("heading", { name: "En attente du client" })).toBeVisible();
    expect((await api.get(`/orders/${code}`)).status).toBe("PICKED_UP");
  });

  await test.step("le client confirme la réception et note le livreur et le restaurant", async () => {
    await page.goto(`/commande/${code}`);
    await expect(page.getByRole("heading", { name: "Avez-vous reçu votre commande ?" })).toBeVisible();
    const receive = page.getByRole("button", { name: "J'ai bien reçu ma commande" });
    await expect(receive).toBeDisabled();
    await page.getByRole("button", { name: "5 sur 5" }).first().click();
    await page.getByRole("button", { name: "4 sur 5" }).last().click();
    await receive.click();
    await expect(page.getByText("Merci, livraison clôturée.")).toBeVisible();
    await expect.poll(async () => (await api.get(`/orders/${code}`)).status).toBe("DELIVERED");
    await page.reload();
    await expect(page.getByText("Livrée").first()).toBeVisible();
  });
});
