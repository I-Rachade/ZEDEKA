import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/equipe/${name}.png`;

// Équipe du restaurant : le gérant ajoute une caissière ; elle se connecte avec son e-mail, ne voit que les
// commandes, accepte une commande à table, la déclare prête, encaisse au comptoir (son nom reste sur la
// commande) et la sert. Elle n'ouvre ni la carte, ni les réglages, ni l'équipe.
test("le gérant ajoute une caissière qui gère les commandes et encaisse", async ({ actor, api, newRestaurant }) => {
  test.setTimeout(300_000);
  const restaurant = await newRestaurant();
  const cashierEmail = `caisse-${Date.now()}@zedeka.test`;

  const owner = await actor({ desktop: true });
  await owner.goto("/restaurant/connexion");
  await owner.getByPlaceholder("E-mail").fill(restaurant.email);
  await owner.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await owner.getByRole("button", { name: "Se connecter" }).click();
  await expect(owner).toHaveURL(/\/restaurant$/);

  let link = "";
  await test.step("le gérant crée une table et ajoute une caissière", async () => {
    await owner.goto("/restaurant/tables");
    await owner.getByLabel("Nombre de tables").fill("1");
    await owner.getByRole("button", { name: "Ajouter", exact: true }).click();
    link = (await owner.locator("li").filter({ hasText: "Table 1" }).getByText(/\/t\//).textContent()) ?? "";

    await owner.getByRole("link", { name: "Équipe" }).first().click();
    await expect(owner.getByText("Aucun membre pour l'instant.")).toBeVisible();
    await owner.getByRole("button", { name: "Ajouter un membre" }).click();
    await owner.getByLabel("Nom").fill("Afi");
    await owner.getByLabel("E-mail de connexion").fill(cashierEmail);
    await owner.getByLabel("Mot de passe").fill("caisse-2026");
    await owner.getByLabel("Rôle").selectOption("CASHIER");
    await owner.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(owner.getByText(cashierEmail)).toBeVisible();
    await owner.screenshot({ path: shots("1-equipe-gerant"), fullPage: true });
  });

  let code = "";
  await test.step("un client commande à la table 1", async () => {
    const guest = await actor();
    await guest.goto(new URL(link).pathname);
    await guest.getByRole("button", { name: `Ajouter ${restaurant.items[0].name}` }).click();
    await guest.getByRole("button", { name: "Voir le panier" }).click();
    await guest.getByRole("dialog", { name: "Panier" }).getByRole("link", { name: "Commander" }).click();
    await guest.getByLabel("Votre prénom").fill("Kodjo");
    await guest.getByRole("checkbox", { name: /J'accepte les/ }).check();
    await guest.getByRole("button", { name: /Envoyer la commande/ }).click();
    code = (await guest.getByText(/^ZD-/).first().textContent())?.trim() ?? "";
    expect(code).toMatch(/^ZD-/);
  });

  await test.step("la caissière se connecte et ne voit que les commandes", async () => {
    const cashier = await actor({ desktop: true });
    await cashier.goto("/restaurant/connexion");
    await cashier.getByPlaceholder("E-mail").fill(cashierEmail);
    await cashier.getByPlaceholder("Mot de passe").fill("caisse-2026");
    await cashier.getByRole("button", { name: "Se connecter" }).click();
    await expect(cashier).toHaveURL(/\/restaurant\/commandes/);
    await cashier.getByRole("alertdialog").getByRole("button", { name: "Voir le détail ou refuser" }).click();
    await expect(cashier.getByRole("heading", { name: `Commande ${code}` })).toBeVisible();
    await cashier.goto("/restaurant/commandes");
    await expect(cashier.getByText("Caissière").first()).toBeVisible();
    await expect(cashier.getByRole("link", { name: "Carte" })).toHaveCount(0);
    await expect(cashier.getByRole("link", { name: "Équipe" })).toHaveCount(0);
    await cashier.screenshot({ path: shots("2-caissiere-commandes"), fullPage: true });

    await cashier.getByRole("link", { name: code, exact: true }).click();
    await cashier.getByRole("button", { name: "Accepter" }).first().click();
    await cashier.getByRole("button", { name: "Commande prête" }).first().click();
    await expect(cashier.getByText(/À encaisser au comptoir/)).toBeVisible();
    await expect(cashier.getByRole("heading", { name: "Modifier la commande" })).toHaveCount(0);
    await cashier.screenshot({ path: shots("3-caissiere-encaisser"), fullPage: true });
    await cashier.getByRole("button", { name: "Encaisser" }).click();
    await expect(cashier.getByText("Encaissé au comptoir")).toBeVisible();
    await expect(cashier.getByText(/Espèces · payé/)).toBeVisible();
    await cashier.screenshot({ path: shots("4-caissiere-encaisse"), fullPage: true });
    await cashier.getByRole("button", { name: "Servie à la table 1" }).first().click();
    await expect.poll(async () => (await api.get(`/orders/${code}`)).status).toBe("DELIVERED");

    // Pages du gérant : renvoyée aux commandes.
    await cashier.goto("/restaurant/carte");
    await expect(cashier).toHaveURL(/\/restaurant\/commandes/);
  });
});
