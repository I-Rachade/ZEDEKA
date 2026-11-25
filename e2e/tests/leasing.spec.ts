import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test, uid, type Driver } from "./fixtures";

const shots = (name: string) => `test-results/leasing/${name}.png`;

async function asDriver(page: Page, d: Driver, token: string) {
  await page.addInitScript((s) => localStorage.setItem("zedeka.driver", JSON.stringify(s)), { token, name: d.name, phone: d.phone });
}

async function adminLogin(page: Page) {
  await page.goto("/admin/connexion#secours");
  await expect(page.getByLabel("Adresse e-mail")).toBeHidden();
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

// Leasing de motos : le directeur ouvre un contrat pour un livreur indépendant (moto Zedeka, 2 000 F par jour),
// le livreur voit ce qu'il doit dans « Ma moto » et envoie un paiement mobile money, l'équipe le confirme,
// puis la moto est rendue.
test("leasing d'une moto : contrat, paiement du livreur, confirmation", async ({ actor, admin, api, newDriver }) => {
  const driver = await newDriver();
  const plate = `TG-${uid().slice(0, 4).toUpperCase()}-LS`;
  const reference = `LS${uid().slice(0, 8).toUpperCase()}`;
  const { devCode } = await api.post<{ devCode: string }>("/livreur/otp/request", { phone: driver.phone });
  const token = (await api.post<{ token: string }>("/livreur/otp/verify", { phone: driver.phone, code: devCode })).token;
  let contractId = "";

  try {
    const desk = await actor({ desktop: true });
    await test.step("directeur : nouveau contrat depuis la fiche du livreur", async () => {
      await adminLogin(desk);
      await desk.goto(`/admin/leasing?livreur=${driver.id}`);
      await expect(desk.getByRole("heading", { name: "Leasing motos" })).toBeVisible();
      await desk.getByRole("radio", { name: /Moto Zedeka/ }).click();
      await desk.getByLabel("Plaque de la moto").fill(plate);
      await desk.getByLabel("Modèle, couleur (facultatif)").fill("Moto électrique verte");
      await desk.screenshot({ path: shots("1-admin-nouveau-contrat"), fullPage: true });
      await desk.getByRole("button", { name: "Ouvrir le contrat" }).click();
      await expect(desk).toHaveURL(/\/admin\/leasing\/[^/?]+$/);
      contractId = desk.url().split("/").pop()!;
      await expect(desk.getByText("À payer aujourd'hui")).toBeVisible();
      await desk.screenshot({ path: shots("2-admin-contrat"), fullPage: true });
    });

    await test.step("livreur : « Ma moto » sur l'accueil, paiement de 3 jours par Flooz", async () => {
      const page = await actor();
      await asDriver(page, driver, token);
      await page.goto("/livreur");
      const card = page.getByRole("link", { name: /Leasing : 2\s000 FCFA à payer aujourd'hui/ });
      await expect(card).toBeVisible();
      await page.screenshot({ path: shots("3-livreur-accueil") });
      await card.click();
      await expect(page.getByText(plate)).toBeVisible();
      await expect(page.getByText("Journée d'aujourd'hui à payer")).toBeVisible();
      await page.getByRole("radio", { name: /7 jours/ }).click();
      await page.getByLabel("Nombre de jours").fill("3");
      await expect(page.getByText(/Envoyez 6\s000 FCFA/)).toBeVisible();
      await page.getByLabel("Référence de la transaction").fill(reference);
      await page.screenshot({ path: shots("4-livreur-payer"), fullPage: true });
      await page.getByRole("button", { name: "Envoyer la référence" }).click();
      await expect(page.getByText("Paiement envoyé : l'équipe le confirme sous peu.")).toBeVisible();
      await expect(page.getByText("À confirmer")).toBeVisible();
    });

    await test.step("directeur : confirme la référence, le livreur est payé 3 jours", async () => {
      await desk.goto("/admin/leasing?onglet=paiements");
      const row = desk.locator("tr", { hasText: reference });
      await expect(row).toBeVisible();
      await desk.screenshot({ path: shots("5-admin-paiements"), fullPage: true });
      await row.getByRole("button", { name: "Confirmer" }).click();
      await expect(row).toHaveCount(0);
      await desk.goto("/admin/leasing");
      await expect(desk.locator("tr", { hasText: plate }).getByText("À jour")).toBeVisible();
      await desk.screenshot({ path: shots("6-admin-contrats"), fullPage: true });
    });

    await test.step("livreur : leasing à jour, payé d'avance", async () => {
      const page = await actor();
      await asDriver(page, driver, token);
      await page.goto("/livreur/moto");
      await expect(page.getByText("Leasing à jour")).toBeVisible();
      await expect(page.getByText(/4\s000 FCFA payés d'avance/)).toBeVisible();
      await expect(page.getByText("Confirmé")).toBeVisible();
      await page.screenshot({ path: shots("7-livreur-a-jour"), fullPage: true });
    });

    await test.step("un salarié ne peut pas louer de moto", async () => {
      const staff = await newDriver({ employment: "STAFF" });
      await expect(admin.post("/admin/leases", { driverId: staff.id, kind: "HOME", plate: `${plate}-X` })).rejects.toThrow(/409.*parc/);
    });
  } finally {
    if (contractId) await admin.post(`/admin/leases/${contractId}/end`, { reason: "Fin du test" });
  }
});
