import type { Page } from "@playwright/test";
import { expect, test, uid } from "./fixtures";

const shots = (name: string) => `test-results/rh-comptabilite/${name}.png`;

async function staffLogin(page: Page, email: string, password: string) {
  await page.goto("/admin/connexion");
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
}

// Ressources humaines et comptabilité : le directeur crée un compte RH et un compte comptable ; les RH créent la
// fiche d'un employé, enregistrent une absence et valident la paie du mois ; le comptable crée la caisse et paie
// le salaire, qui s'écrit au journal. Chaque rôle reste sur ses écrans.
test("RH : fiche, absence et paie ; comptable : paiement du salaire au journal", async ({ actor, admin }) => {
  const id = uid();
  const hr = { name: `RH ${id}`, email: `rh-${id}@zedeka.test`, password: "ressources-humaines-2026" };
  const accountant = { name: `Compta ${id}`, email: `compta-${id}@zedeka.test`, password: "comptable-zedeka-2026" };
  await admin.post("/admin/team", { ...hr, role: "HR" });
  await admin.post("/admin/team", { ...accountant, role: "ACCOUNTANT" });
  const employee = `Employé ${id}`;
  const month = new Date().toISOString().slice(0, 7);

  await test.step("RH : connexion, arrivée sur les ressources humaines, sans les commandes", async () => {
    const page = await actor({ desktop: true });
    await staffLogin(page, hr.email, hr.password);
    await expect(page).toHaveURL(/\/admin\/rh$/);
    await expect(page.getByRole("heading", { name: "Ressources humaines" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Commandes/ })).toHaveCount(0);
    await page.goto("/admin/commandes");
    await expect(page).toHaveURL(/\/admin\/rh$/);

    await page.getByRole("button", { name: "Nouvel employé" }).click();
    await page.getByLabel("Nom complet").fill(employee);
    await page.getByLabel("Téléphone", { exact: true }).fill("90 11 22 33");
    await page.getByLabel("Poste", { exact: true }).fill("Agent de bureau");
    await page.getByLabel("Service", { exact: true }).fill("Bureau");
    await page.getByLabel("Date d'embauche").fill(`${month.slice(0, 4)}-01-02`);
    await page.getByLabel("Salaire mensuel (FCFA)").fill("78000");
    await page.screenshot({ path: shots("1-rh-nouvel-employe"), fullPage: true });
    await page.getByRole("button", { name: "Créer la fiche" }).click();
    await expect(page).toHaveURL(/\/admin\/rh\/[^/]+$/);
    await expect(page.getByRole("heading", { name: employee })).toBeVisible();

    // Une absence non justifiée d'un jour ouvrable ce mois-ci : retenue de 78 000 / 26 = 3 000 F.
    let day = new Date(`${month}-02T00:00:00Z`);
    if (day.getUTCDay() === 0) day = new Date(day.getTime() + 86_400_000);
    const iso = day.toISOString().slice(0, 10);
    await page.getByRole("button", { name: "Ajouter", exact: true }).click();
    const leave = page.locator("form").filter({ hasText: "Décision" });
    await leave.locator('select[name="kind"]').selectOption("ABSENCE");
    await leave.getByLabel("Du", { exact: true }).fill(iso);
    await leave.getByLabel("Au (inclus)").fill(iso);
    await leave.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText("Absence non justifiée")).toBeVisible();
    await page.screenshot({ path: shots("2-rh-fiche"), fullPage: true });

    await page.goto("/admin/rh?onglet=paie");
    await page.getByRole("button", { name: "Préparer ou recalculer la paie" }).click();
    const row = page.getByRole("row", { name: new RegExp(employee) });
    await expect(row).toContainText("75 000");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Valider la paie du mois" }).click();
    await expect(row).toContainText("Validé, à payer");
    await page.screenshot({ path: shots("3-rh-paie"), fullPage: true });
  });

  await test.step("comptable : caisse, paiement du salaire, écriture au journal", async () => {
    const page = await actor({ desktop: true });
    await staffLogin(page, accountant.email, accountant.password);
    await expect(page).toHaveURL(/\/admin\/comptabilite$/);
    await expect(page.getByRole("heading", { name: "Comptabilité" })).toBeVisible();
    await page.goto("/admin/rh");
    await expect(page).toHaveURL(/\/admin\/comptabilite$/);

    await page.getByRole("button", { name: "Comptes" }).click();
    await page.getByLabel("Nom du compte").fill(`Caisse ${id}`);
    await page.getByLabel("Solde au départ (FCFA)").fill("500000");
    await page.getByRole("button", { name: "Créer le compte" }).click();
    await expect(page.getByText(`Caisse ${id}`).first()).toBeVisible();

    await page.getByRole("button", { name: "Salaires" }).click();
    await page.getByLabel("Compte qui paie").selectOption({ label: `Payer depuis : Caisse ${id}` });
    const card = page.getByRole("row", { name: new RegExp(employee) });
    page.once("dialog", (d) => d.accept("TM-E2E"));
    await card.getByRole("button", { name: "Payer" }).click();
    await expect(card).toContainText("Payé");
    await page.screenshot({ path: shots("4-comptable-salaires"), fullPage: true });

    await page.getByRole("button", { name: "Journal" }).click();
    await expect(page.getByText(`Salaire ${month} — ${employee}`).first()).toBeVisible();
    await page.getByRole("button", { name: "Synthèse" }).click();
    await expect(page.getByRole("heading", { name: "Chiffres de la plateforme" })).toBeVisible();
    await expect(page.getByText(/^Salaires payés/)).toBeVisible();
    await page.screenshot({ path: shots("5-comptable-synthese"), fullPage: true });
  });
});
