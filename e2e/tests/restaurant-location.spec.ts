import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/position-restaurant/${name}.png`;

// Position obligatoire d'un restaurant : l'admin ne peut pas créer sans position ; il la demande au gérant par un
// lien ; le restaurant reste masqué ; le gérant l'ouvre et donne la position ; l'admin peut alors le rendre visible.
test("la position du restaurant est obligatoire, et peut être demandée au gérant", async ({ actor, admin }) => {
  const page = await actor({ desktop: true });
  await page.goto("/admin/connexion");
  await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/restaurants");

  const name = `Maquis Position ${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "Ajouter" }).click();
  await page.getByPlaceholder("Nom", { exact: true }).fill(name);
  await page.getByPlaceholder("Téléphone", { exact: true }).fill("90112233");
  await page.getByPlaceholder("Quartier, Lomé").fill("Bè, Lomé");
  await page.screenshot({ path: shots("1-creation-choix"), fullPage: true });

  // Sans position : refusé.
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Placez le restaurant sur la carte" })).toBeVisible();
  await page.screenshot({ path: shots("2-creation-sans-position"), fullPage: true });

  // Demande au gérant : lien prêt à envoyer sur WhatsApp, restaurant masqué.
  await page.getByRole("button", { name: /Demander au gérant/ }).click();
  await page.getByRole("button", { name: "Créer et obtenir le lien" }).click();
  await expect(page.getByText("Lien prêt à envoyer au gérant")).toBeVisible();
  await expect(page.getByRole("link", { name: "Envoyer sur WhatsApp" })).toHaveAttribute("href", /wa\.me\/22890112233/);
  await page.screenshot({ path: shots("3-lien-gerant"), fullPage: true });
  const message = await page.locator("p.break-all").innerText();
  const url = new URL(message.match(/https?:\/\/\S+\/position\/[A-Za-z0-9_-]{22}/)![0]);

  await page.getByRole("link", { name: "Ouvrir la fiche du restaurant" }).click();
  await expect(page.getByText(/Position demandée au gérant, en attente/)).toBeVisible();
  await expect(page.getByLabel("Visible pour les clients")).toBeDisabled();
  await page.screenshot({ path: shots("4-fiche-en-attente"), fullPage: true });
  const restaurantId = page.url().split("/").pop()!;
  const list = await admin.get<{ id: string; active: boolean; locationState: string }[]>("/admin/restaurants");
  expect(list.find((r) => r.id === restaurantId)).toMatchObject({ active: false, locationState: "REQUESTED" });

  // Le gérant ouvre le lien au restaurant et partage sa position.
  const manager = await actor({ geolocation: { latitude: 6.1319, longitude: 1.2386 } });
  await manager.goto(url.pathname);
  await expect(manager.getByRole("heading", { name: `Où se trouve ${name} ?` })).toBeVisible();
  await expect(manager.getByRole("button", { name: "Non merci" })).toHaveCount(0);
  await manager.screenshot({ path: shots("5-gerant-demande"), fullPage: true });
  await manager.getByRole("button", { name: "Je suis au restaurant : partager ma position" }).click();
  await manager.getByLabel("Repère pour les livreurs (facultatif)").fill("face à la pharmacie");
  await manager.screenshot({ path: shots("6-gerant-position-trouvee"), fullPage: true });
  await manager.getByRole("button", { name: /Envoyer/ }).click();
  await expect(manager.getByRole("heading", { name: "Position du restaurant enregistrée, merci" })).toBeVisible();
  await manager.screenshot({ path: shots("7-gerant-merci"), fullPage: true });

  // L'admin voit la position et peut rendre le restaurant visible.
  await page.reload();
  await expect(page.getByText("6.13190, 1.23860")).toBeVisible();
  await expect(page.getByLabel("Visible pour les clients")).toBeEnabled();
  await page.screenshot({ path: shots("8-fiche-position-recue"), fullPage: true });
  const r = await admin.get<{ latitude: number; address: string; locationState: string }>(`/admin/restaurants/${restaurantId}`);
  expect(r).toMatchObject({ latitude: 6.1319, address: "Bè, Lomé · Repère : face à la pharmacie", locationState: "SET" });
});
