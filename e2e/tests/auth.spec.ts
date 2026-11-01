import { expect, test, uniquePhone } from "./fixtures";

// Compte client : inscription avec le code SMS (affiché à l'écran en mode test) et choix du code PIN,
// puis reconnexion avec le numéro et le PIN.

test("inscription par SMS puis connexion par code PIN", async ({ page }) => {
  const phone = uniquePhone();
  await page.goto("/app/connexion");

  await page.getByRole("tab", { name: "Inscription" }).click();
  await page.getByPlaceholder("Prénom et nom").fill("Afi Mensah");
  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByRole("checkbox", { name: /J'accepte les/ }).check();
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

// Livreur : plus d'inscription en ligne, son compte (avec code PIN) est créé dans l'admin. L'ancien lien
// /devenir-livreur mène à la connexion ; un compte encore en attente montre où il en est.
test("livreur : compte créé par l'admin, l'ancien lien d'inscription mène à la connexion", async ({ page, admin }) => {
  const phone = uniquePhone();
  const email = `livreur${phone.replace(/\D/g, "")}@exemple.tg`;
  await admin.post("/admin/drivers", { name: "Kossi Agbeko", phone: `+228${phone.replace(/\s/g, "")}`, email, pin: "4826", status: "PENDING", active: false });

  await page.goto("/devenir-livreur");
  await expect(page).toHaveURL(/\/livreur\/connexion$/);
  await expect(page.getByText("Votre compte livreur est créé par l'équipe Zedeka.", { exact: false })).toBeVisible();

  await page.getByLabel("Numéro de téléphone").fill(phone);
  await page.getByLabel("Code PIN").fill("1111");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Identifiant ou code PIN incorrect")).toBeVisible();

  await page.getByLabel("Code PIN").fill("4826");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/livreur\/candidature$/);
  await expect(page.getByText("Candidature en cours d'examen")).toBeVisible();

  // Même chose avec l'e-mail.
  await page.goto("/livreur/connexion");
  await page.getByRole("button", { name: "E-mail" }).click();
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Code PIN").fill("4826");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("Candidature en cours d'examen")).toBeVisible();
});
