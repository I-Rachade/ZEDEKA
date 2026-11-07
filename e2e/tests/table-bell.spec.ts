import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/sonnerie/${name}.png`;

// Sonnerie de table : le client de la table 4 demande l'addition depuis le QR code ; l'espace restaurant sonne
// avec un bandeau « Table 4 » ; le serveur touche « J'arrive », le client le voit, puis « Fait » ferme l'appel.
// Le gérant coupe la sonnerie : le bouton disparaît de la carte de la table.
test("sonnerie de table : addition demandée, J'arrive, Fait, sonnerie coupée", async ({ actor, newRestaurant }) => {
  test.setTimeout(300_000);
  const restaurant = await newRestaurant();

  const panel = await actor({ desktop: true });
  await panel.goto("/restaurant/connexion");
  await panel.getByPlaceholder("E-mail").fill(restaurant.email);
  await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await expect(panel).toHaveURL(/\/restaurant$/);

  let link = "";
  await test.step("le gérant crée ses tables, la sonnerie est activée", async () => {
    await panel.goto("/restaurant/tables");
    await panel.getByLabel("Nombre de tables").fill("4");
    await panel.getByRole("button", { name: "Ajouter", exact: true }).click();
    await expect(panel.getByAltText("QR code de la table 4")).toBeVisible();
    await expect(panel.getByRole("switch", { name: "Sonnerie de table" })).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByText("Pas encore d'appel cette semaine.")).toBeVisible();
    link = (await panel.locator("li").filter({ hasText: "Table 4" }).getByText(/\/t\//).textContent()) ?? "";
    expect(link).toMatch(/\/t\/[A-Za-z0-9_-]{12}$/);
  });

  const guest = await actor();
  await test.step("le client de la table 4 demande l'addition en espèces", async () => {
    await guest.goto(new URL(link).pathname);
    await guest.getByRole("button", { name: "Sonner le serveur" }).click();
    const sheet = guest.getByRole("dialog", { name: "Sonner le serveur" });
    await expect(sheet.getByText("Besoin du serveur ?")).toBeVisible();
    await guest.screenshot({ path: shots("1-client-choix") });
    await sheet.getByRole("button", { name: /Demander l'addition/ }).click();
    await sheet.getByRole("button", { name: /Espèces/ }).click();
    await expect(sheet.getByText("Le restaurant est prévenu.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Sonner à nouveau dans/ })).toBeDisabled();
    await guest.screenshot({ path: shots("2-client-en-attente") });
  });

  await test.step("le restaurant voit et entend la table 4, répond « J'arrive »", async () => {
    const banner = panel.getByRole("alert").filter({ hasText: "Table 4" });
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await expect(banner.getByText("Addition · espèces")).toBeVisible();
    await panel.screenshot({ path: shots("3-restaurant-sonne") });
    await banner.getByRole("button", { name: "J'arrive" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Table 4" })).toBeVisible();
  });

  await test.step("le client voit que le serveur arrive", async () => {
    await expect(guest.getByText("Le serveur a vu votre appel et arrive.")).toBeVisible({ timeout: 15_000 });
    await guest.screenshot({ path: shots("4-client-serveur-arrive") });
  });

  await test.step("« Fait » ferme l'appel, le temps de réponse s'affiche", async () => {
    await panel.getByRole("status").filter({ hasText: "Table 4" }).getByRole("button", { name: "Fait" }).click();
    await expect(panel.getByRole("region", { name: "Appels des tables" })).toHaveCount(0);
    await panel.reload();
    await expect(panel.getByText(/Temps moyen de réponse sur 7 jours : .* · 1 appel\(s\)/)).toBeVisible();
    await panel.screenshot({ path: shots("5-reglage-sonnerie") });
  });

  await test.step("sonnerie coupée : plus de bouton sur la carte de la table", async () => {
    await panel.getByRole("switch", { name: "Sonnerie de table" }).click();
    await expect(panel.getByRole("switch", { name: "Sonnerie de table" })).toHaveAttribute("aria-checked", "false");
    await guest.reload();
    await expect(guest.getByText("Table 4 · sur place")).toBeVisible();
    await expect(guest.getByRole("button", { name: "Sonner le serveur" })).toHaveCount(0);
  });
});
