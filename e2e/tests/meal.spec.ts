import { ADMIN_PASSWORD } from "../env.mjs";
import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Commande de repas complète : le client commande sans compte avec sa position (prix au km),
// le restaurant accepte et prépare, la répartition affecte un livreur, le livreur récupère et livre,
// le client voit « Livrée » sur son suivi.

// Grille de prix des réglages (27/11/2026) : 500 FCFA jusqu'à 5 km, 1 000 FCFA jusqu'à 10 km, 1 500 FCFA au-delà.
// 0,054° de latitude au nord du restaurant ≈ 6,0 km, soit 1 000 FCFA.
const NORTH_6_KM = 0.054;
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);
// Montant exact : « 500 FCFA » ne doit pas trouver « 2 500 FCFA ».
const exactFcfa = (n: number) => new RegExp(`^${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA$`);

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
    // La barre mène droit à la caisse, sans passer par le panier ni par un choix de compte.
    const bar = page.getByRole("link", { name: /^Commander · 3 article\(s\)/ });
    await expect(bar).toContainText(fcfa(3500));
    await bar.click();

    // Caisse sur un seul écran : la position actuelle est prise d'office, le repère écrit est facultatif.
    await expect(page.getByText("6 km du restaurant", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Un repère pour le livreur/ }).click();
    await page.getByLabel("Repère pour le livreur (facultatif)").fill("Agoè, derrière la pharmacie du marché");

    // Sans nom ni numéro, « Commander » signale ce qui manque au lieu d'envoyer.
    await page.getByRole("button", { name: /^Commander/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Il manque 2 informations" })).toBeVisible();
    await page.getByLabel("Votre nom").fill(customer.name);
    await page.getByLabel("Téléphone", { exact: true }).fill(customer.phone);

    // Livraison calculée sur la distance depuis le restaurant, pas sur le tarif de la zone.
    await expect(page.getByText("Livraison (6 km)")).toBeVisible();
    const summary = page.locator("aside");
    await expect(summary.getByText(exactFcfa(1000)).first()).toBeVisible();
    await expect(summary.getByText(fcfa(4500))).toBeVisible();

    // Pas de case à cocher : la phrase sous le bouton vaut accord.
    await expect(page.getByText("En commandant, vous acceptez les").first()).toBeVisible();
    await page.getByRole("button", { name: /^Commander/ }).click();

    await expect(page.getByRole("heading", { name: "C'est commandé !" })).toBeVisible();
    code = await createdCode(page);
    // La confirmation ouvre le suivi, qui interroge l'API toutes les 4 s : on le quitte pendant que le restaurant et le
    // livreur jouent leur part, pour ne pas épuiser la limite de lectures (toutes les pages viennent de la même adresse).
    await page.goto("about:blank");
  });

  // L'API a recalculé le même prix que la page.
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ status: "PENDING", subtotal: 3500, deliveryFee: 1000, total: 4500 });

  await test.step("le restaurant accepte, prépare et signale « prête »", async () => {
    const panel = await actor({ desktop: true });
    await panel.goto("/restaurant/connexion");
    await panel.getByPlaceholder("E-mail").fill(restaurant.email);
    await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
    await panel.getByRole("button", { name: "Se connecter" }).click();

    // Alarme plein écran : la commande y est montrée avec « Accepter · 15 min » ; ici on ouvre la fiche.
    const alarm = panel.getByRole("alertdialog");
    await expect(alarm.getByText(code)).toBeVisible();
    await expect(alarm.getByRole("button", { name: "Accepter · 15 min" })).toBeVisible();
    await alarm.getByRole("button", { name: "Voir le détail ou refuser" }).click();
    await expect(panel.getByRole("heading", { name: `Commande ${code}` })).toBeVisible();
    // Étape par étape : le livreur n'apparaît qu'une fois la commande acceptée.
    await expect(panel.getByText("Acceptez la commande pour voir quel livreur viendra la chercher.")).toBeVisible();
    // Avec un temps de préparation, « Accepter » lance directement la préparation.
    await panel.getByRole("button", { name: "20 min" }).click();
    await panel.getByRole("button", { name: "Accepter" }).first().click();
    await expect(panel.getByText("Préparation annoncée : 20 min")).toBeVisible();
    await panel.getByRole("button", { name: "Commande prête" }).first().click();
    await expect.poll(async () => (await api.get(`/orders/${code}`)).status).toBe("READY");
  });

  await test.step("la répartition affecte le livreur", async () => {
    const dispatch = await actor({ desktop: true });
    await dispatch.goto("/admin/connexion#secours");
    await expect(dispatch.getByLabel("Adresse e-mail")).toBeHidden();
    await dispatch.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await dispatch.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(dispatch).toHaveURL(/\/admin$/);
    await dispatch.goto("/admin/dispatch");
    await dispatch.getByRole("tab", { name: "Liste" }).click();
    await dispatch.getByLabel(`Livreur pour ${code}`).selectOption(driver.id);
    await expect(dispatch.getByText(`Envoyée à ${driver.name}, en attente de réponse`)).toBeVisible();
  });

  await test.step("le livreur accepte, récupère et livre en encaissant les espèces", async () => {
    const app = await actor({ geolocation: { latitude: restaurant.latitude, longitude: restaurant.longitude } });
    await app.goto("/livreur/connexion");
    // Connexion comme un client : numéro et code PIN (donné par l'admin à l'ajout du livreur).
    await app.getByLabel("Numéro de téléphone").fill(driver.phone);
    await app.getByLabel("Code PIN").fill(driver.pin);
    await app.getByRole("button", { name: "Se connecter" }).click();

    const offer = app.getByRole("alertdialog", { name: `Nouvelle course ${code}` });
    await expect(offer).toBeVisible({ timeout: 30_000 });
    await offer.getByRole("button", { name: "Glisser pour accepter" }).press("Enter");

    await app.getByText(code).first().click();
    // Les boutons à glisser se valident aussi au clavier (Entrée), une fois actifs.
    const pickedUp = app.getByRole("button", { name: "Glisser : commande récupérée" });
    // Une étape à la fois : la livraison (adresse, appel du client) reste verrouillée avant le ramassage.
    const locked = app.getByText("L'adresse et le contact du client s'afficheront une fois la commande récupérée.");
    await expect(locked).toBeVisible();
    await expect(app.getByRole("link", { name: "Client", exact: true })).toHaveCount(0);
    await expect(pickedUp).toHaveAttribute("aria-disabled", "false");
    await pickedUp.press("Enter");
    await expect(app.getByRole("link", { name: "Client", exact: true })).toBeVisible();
    await expect(locked).toHaveCount(0);
    const delivered = app.getByRole("button", { name: "Glisser : commande livrée" });
    await expect(delivered).toHaveAttribute("aria-disabled", "false");
    await delivered.press("Enter");
    const cash = app.getByRole("dialog");
    // Montant exact proposé d'office ; le champ ne s'ouvre que pour un autre montant.
    await expect(cash.getByText("Espèces reçues")).toBeVisible();
    await cash.getByRole("button", { name: "Autre montant ?" }).click();
    await expect(cash.getByLabel("Montant reçu")).toHaveValue("4400");
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
