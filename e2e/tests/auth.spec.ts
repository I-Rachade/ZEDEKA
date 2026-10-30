import { expect, test, uniquePhone } from "./fixtures";

// Compte client : inscription avec le code SMS (affiché à l'écran en mode test) et choix du code PIN,
// puis reconnexion avec le numéro et le PIN.

test("inscription par SMS puis connexion par code PIN", async ({ page }) => {
  const phone = uniquePhone();
  await page.goto("/app/connexion");

  await page.getByRole("tab", { name: "Inscription" }).click();
  await page.getByPlaceholder("Prénom et nom").fill("Afi Mensah");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("button", { name: "Recevoir le code" }).click();

  // Sans fournisseur SMS, l'API renvoie le code et la page l'affiche.
  const devCode = page.getByText(/Mode test, aucun SMS/).locator("strong");
  const code = (await devCode.textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel("Code à 6 chiffres").fill(code);
  await page.getByRole("button", { name: "Valider" }).click();

  await expect(page.getByRole("heading", { name: "Choisissez votre code PIN" })).toBeVisible();
  // Deux PIN différents : refus avant tout appel.
  await page.getByLabel("Nouveau code PIN").fill("4826");
  await page.getByLabel("Confirmez le code PIN").fill("4827");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page.getByText("Les deux codes PIN ne sont pas identiques")).toBeVisible();

  await page.getByLabel("Confirmez le code PIN").fill("4826");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await expect(page).toHaveURL(/\/app$/);

  // Nouvelle visite sans session : connexion avec le numéro et le PIN.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/app/connexion");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Code PIN").fill("1111");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Identifiant ou code PIN incorrect")).toBeVisible();

  await page.getByLabel("Code PIN").fill("4826");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.goto("/app/profil");
  await expect(page.getByText("Afi Mensah")).toBeVisible();
});
