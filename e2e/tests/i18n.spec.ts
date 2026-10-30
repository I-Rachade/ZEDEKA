import { expect, test, uniquePhone } from "./fixtures";

// Français par défaut, anglais au choix (bouton FR / EN) : le choix tient après rechargement (cookie « lang »),
// vaut aussi pour les pages rendues côté serveur et pour les messages d'erreur de l'API.

test("passage du français à l'anglais et retour", async ({ page, context, newRestaurant }) => {
  const restaurant = await newRestaurant();
  await page.goto("/app/connexion");
  await expect(page.getByRole("tab", { name: "Inscription" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible();

  await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "EN" }).click();
  await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === "lang")?.value).toBe("en");

  // Le choix reste après rechargement.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Sign up" })).toBeVisible();

  // Message d'erreur de l'API traduit lui aussi.
  await page.getByLabel("Phone number").fill(uniquePhone());
  await page.getByLabel("PIN code").fill("4826");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Wrong phone, email or PIN")).toBeVisible();

  // Page rendue côté serveur : carte du restaurant en anglais.
  await page.goto(`/r/${restaurant.slug}`);
  await expect(page.getByText("No minimum")).toBeVisible();
  await page.getByRole("button", { name: "Add Riz au poulet" }).click();
  await expect(page.getByRole("button", { name: "View cart" })).toBeVisible();

  // Retour au français.
  await page.goto("/app/connexion");
  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "FR" }).click();
  await expect(page.getByRole("tab", { name: "Inscription" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Se connecter", exact: true })).toBeVisible();
});
