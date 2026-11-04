import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/sante/${name}.png`;

// Page « Santé » du back-office : le directeur voit si le serveur et la base répondent, la dernière activité
// de chaque appli et ce qui cloche sur le terrain.
test("le directeur ouvre la santé de la plateforme", async ({ actor }) => {
  const boss = await actor({ desktop: true });
  await boss.goto("/admin/connexion");
  await boss.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
  await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(boss).toHaveURL(/\/admin$/);
  await boss.getByRole("link", { name: "Santé" }).click();
  await expect(boss).toHaveURL(/\/admin\/sante$/);
  await expect(boss.getByRole("heading", { name: "Santé de la plateforme" })).toBeVisible();
  await expect(boss.getByText("Base de données")).toBeVisible();
  await expect(boss.getByText("Dernière connexion de l'équipe")).toBeVisible();
  await expect(boss.getByText(/Tout va bien|À surveiller/)).toBeVisible();
  await expect(boss.getByText(/^\d+ ms$/).first()).toBeVisible();
  await boss.screenshot({ path: shots("1-sante"), fullPage: true });
});
