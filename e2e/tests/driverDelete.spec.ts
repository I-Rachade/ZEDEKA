import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test } from "./fixtures";

// Le directeur supprime deux livreurs depuis l'admin : l'un sans historique (effacé), l'autre avec un problème
// signalé (compte fermé, coordonnées effacées, nom gardé dans l'historique de la répartition).
test("le directeur supprime un livreur après confirmation", async ({ actor, admin, newDriver, driverApi }) => {
  const fresh = await newDriver();
  const veteran = await newDriver();
  const veteranApi = await driverApi(veteran);
  await veteranApi.post("/livreur/issues", { kind: "CUSTOMER_UNREACHABLE", note: "Test suppression" });

  const page = await actor({ desktop: true });
  await page.goto("/admin/connexion");
  await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/livreurs");

  for (const d of [fresh, veteran]) {
    const row = page.locator("li", { hasText: d.name });
    await expect(row.getByRole("button", { name: "Supprimer" })).toBeVisible();
    if (d === fresh) await row.screenshot({ path: "test-results/livreur-supprimer.png" });
    let message = "";
    page.once("dialog", (dialog) => {
      message = dialog.message();
      void dialog.accept();
    });
    await row.getByRole("button", { name: "Supprimer" }).click();
    await expect(page.getByText(d.name)).toHaveCount(0);
    expect(message).toContain(`Supprimer ${d.name} ?`);
  }

  // Le livreur supprimé ne peut plus utiliser sa session ; son signalement reste avec son nom.
  await expect(veteranApi.get("/livreur/me")).rejects.toThrow(/401/);
  const dispatch = await admin.get<{ issues: { driver: { name: string; phone: string } }[] }>("/admin/dispatch");
  expect(dispatch.issues.some((i) => i.driver.name === veteran.name)).toBe(true);
  // Son numéro est libéré : il pourrait se réinscrire.
  expect(dispatch.issues.find((i) => i.driver.name === veteran.name)?.driver.phone).toMatch(/^supprime-/);
});
