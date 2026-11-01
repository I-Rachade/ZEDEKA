import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/horaires/${name}.png`;
const DAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const hhmm = (d: Date) => d.toISOString().slice(11, 16);

// Horaires d'ouverture : l'admin les saisit sur la fiche du restaurant ; le client voit la semaine, le restaurant
// fermé hors horaires avec l'heure de réouverture, et ne peut pas commander ; le gérant retrouve les mêmes horaires.
test("l'admin fixe les horaires, le client les voit et ne commande pas hors horaires", async ({ actor, api, newRestaurant }) => {
  const restaurant = await newRestaurant();
  // Créneau qui commence dans 2 heures (heure de Lomé = UTC) : le restaurant est fermé maintenant.
  const now = new Date();
  const opens = new Date(now.getTime() + 2 * 3_600_000);
  const closes = new Date(now.getTime() + 4 * 3_600_000);
  const day = DAYS[opens.getUTCDay()];

  const page = await actor({ desktop: true });
  await page.goto("/admin/connexion");
  await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto(`/admin/restaurants/${restaurant.id}`);

  const row = page.locator("li").filter({ has: page.getByText(day, { exact: true }) });
  await row.getByRole("button", { name: "+ créneau" }).click();
  await page.getByLabel(`Ouverture ${day}`).fill(hhmm(opens));
  await page.getByLabel(`Fermeture ${day}`).fill(hhmm(closes));
  // Et un créneau un autre jour, en plus.
  const other = DAYS[(opens.getUTCDay() + 3) % 7];
  await page.locator("li").filter({ has: page.getByText(other, { exact: true }) }).getByRole("button", { name: "+ créneau" }).click();
  await page.getByRole("button", { name: "Enregistrer les horaires" }).click();
  await expect(page.getByText("Enregistré")).toBeVisible();
  await page.getByText("Copier le lundi sur toute la semaine").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shots("1-admin-horaires") });

  // Le client voit le restaurant fermé, l'heure de réouverture et les horaires de la semaine.
  const customer = await actor();
  await customer.goto(`/r/${restaurant.slug}`);
  await expect(customer.getByText("Fermé pour le moment.")).toBeVisible();
  await expect(customer.getByText(new RegExp(`Ouverture (aujourd'hui|demain) à ${hhmm(opens)}`))).toBeVisible();
  await customer.getByText("Voir la semaine").click();
  await expect(customer.getByText(`${hhmm(opens)}–${hhmm(closes)}`).first()).toBeVisible();
  await customer.screenshot({ path: shots("2-client-ferme") });

  // La commande est refusée par l'API hors horaires.
  const item = restaurant.items[0];
  await expect(
    api.post("/orders", {
      acceptTerms: true,
      restaurantSlug: restaurant.slug,
      fulfillment: "PICKUP",
      items: [{ menuItemId: item.id, quantity: 1 }],
      customerName: "Client Horaires",
      customerPhone: "90000001",
      paymentMethod: "CASH",
    }),
  ).rejects.toThrow(/fermé/);

  // Le gérant retrouve les horaires dans son espace.
  const panel = await actor({ desktop: true });
  await panel.goto("/restaurant/connexion");
  await panel.getByPlaceholder("E-mail").fill(restaurant.email);
  await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await panel.goto("/restaurant/reglages");
  await expect(panel.getByLabel(`Ouverture ${day}`)).toHaveValue(hhmm(opens));
  await expect(panel.getByLabel(`Ouverture ${other}`)).toHaveValue("11:00");
  await panel.getByText("Copier le lundi sur toute la semaine").scrollIntoViewIfNeeded();
  await panel.screenshot({ path: shots("3-gerant-horaires") });
});
