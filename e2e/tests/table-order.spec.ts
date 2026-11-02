import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/tables/${name}.png`;

// Commande à table : le gérant crée ses tables et imprime les QR codes ; le client scanne celui de la table 2,
// commande sur place sans numéro de téléphone ; la commande arrive dans l'espace restaurant avec le numéro de la
// table, sans livraison ni commission ; le restaurant la sert, le client voit « Servie à la table 2 ».
test("tables numérotées avec QR code, commande sur place servie à table", async ({ actor, api, newRestaurant }) => {
  test.setTimeout(300_000);
  const restaurant = await newRestaurant();

  const panel = await actor({ desktop: true });
  await panel.goto("/restaurant/connexion");
  await panel.getByPlaceholder("E-mail").fill(restaurant.email);
  await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await expect(panel).toHaveURL(/\/restaurant$/);

  let link = "";
  await test.step("le gérant crée 3 tables et voit leurs QR codes", async () => {
    await panel.goto("/restaurant/tables");
    await expect(panel.getByText("Aucune table pour le moment.")).toBeVisible();
    await panel.getByLabel("Nombre de tables").fill("3");
    await panel.getByRole("button", { name: "Ajouter", exact: true }).click();
    for (const n of [1, 2, 3]) await expect(panel.getByAltText(`QR code de la table ${n}`)).toBeVisible();
    await expect(panel.getByText("à partir de la table 4")).toBeVisible();
    await panel.screenshot({ path: shots("1-tables-qr"), fullPage: true });
    link = (await panel.locator("li").filter({ hasText: "Table 2" }).getByText(/\/t\//).textContent()) ?? "";
    expect(link).toMatch(/\/t\/[A-Za-z0-9_-]{12}$/);
  });

  let code = "";
  await test.step("le client scanne la table 2 et commande sur place", async () => {
    const guest = await actor();
    await guest.goto(new URL(link).pathname);
    await expect(guest.getByText("Table 2 · sur place")).toBeVisible();
    await guest.getByRole("button", { name: `Ajouter ${restaurant.items[0].name}` }).click();
    await guest.getByRole("button", { name: "Voir le panier" }).click();
    const cart = guest.getByRole("dialog", { name: "Panier" });
    await expect(cart.getByText("Servi à votre table, sans frais de livraison.")).toBeVisible();
    await guest.screenshot({ path: shots("2-carte-table") });
    await cart.getByRole("link", { name: "Commander" }).click();

    await expect(guest.getByText("Table 2 · sur place")).toBeVisible();
    await guest.getByLabel("Votre prénom").fill("Afi");
    await guest.getByLabel(/Remarque pour la cuisine/).fill("Sans piment");
    await guest.getByRole("checkbox", { name: /J'accepte les/ }).check();
    await guest.screenshot({ path: shots("3-caisse-table"), fullPage: true });
    await guest.getByRole("button", { name: /Envoyer la commande/ }).click();
    await expect(guest.getByRole("heading", { name: "Commande envoyée au restaurant" })).toBeVisible();
    await expect(guest.getByText("à la table 2")).toBeVisible();
    code = (await guest.getByText(/^ZD-/).first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^ZD-/);
    await guest.screenshot({ path: shots("4-commande-envoyee") });
  });

  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ status: "PENDING", fulfillment: "PICKUP", tableNumber: 2, deliveryFee: 0, total: restaurant.items[0].price });

  await test.step("le restaurant reçoit la commande de la table 2 et la sert", async () => {
    await panel.goto("/restaurant/commandes");
    // Alarme plein écran pour la nouvelle commande.
    await panel.getByRole("button", { name: "Voir" }).click();
    const row = panel.getByRole("row").filter({ hasText: code });
    await expect(row.getByText("Table 2")).toBeVisible();
    await row.click();
    await expect(panel.getByText("Commande sur place : apportez-la à la table, sans livreur.")).toBeVisible();
    // Avec un temps de préparation, « Accepter » lance directement la préparation.
    await panel.getByRole("button", { name: "10 min" }).click();
    await panel.getByRole("button", { name: "Accepter" }).first().click();
    await expect(panel.getByText("Préparation annoncée : 10 min")).toBeVisible();
    await panel.getByRole("button", { name: "Commande prête" }).first().click();
    await panel.screenshot({ path: shots("5-restaurant-commande-table"), fullPage: true });
    await panel.getByRole("button", { name: "Servie à la table 2" }).first().click();
    await expect.poll(async () => (await api.get(`/orders/${code}`)).status).toBe("DELIVERED");
  });

  await test.step("le client voit sa commande servie", async () => {
    const guest = await actor();
    await guest.goto(`/commande/${code}`);
    await expect(guest.getByText("Servie à table")).toBeVisible();
    await guest.screenshot({ path: shots("6-suivi-servie") });
  });
});
