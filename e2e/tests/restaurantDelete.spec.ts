import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

const shots = (name: string) => `test-results/restaurant-supprimer/${name}.png`;

// Le directeur supprime deux restaurants depuis leur fiche, en tapant « supprimer » : l'un sans commande (effacé),
// l'autre avec une commande passée (masqué, accès fermés, nom gardé sur la commande). Une commande en cours bloque.
test("le directeur supprime un restaurant en tapant « supprimer »", async ({ actor, admin, api, newRestaurant, restaurantApi }) => {
  const fresh = await newRestaurant();
  const veteran = await newRestaurant();
  const veteranApi = await restaurantApi(veteran);
  const { code } = await api.post<{ code: string }>("/orders", {
    acceptTerms: true,
    restaurantSlug: veteran.slug,
    fulfillment: "PICKUP",
    customerName: "Client Suppression",
    customerPhone: `+228${uniquePhone().replace(/\s/g, "")}`,
    paymentMethod: "CASH",
    items: [{ menuItemId: veteran.items[0].id, quantity: 1 }],
  });
  const [order] = await veteranApi.get<{ id: string }[]>(`/restaurant/orders?q=${code}`);

  const page = await actor({ desktop: true });
  await page.goto("/admin/connexion");
  await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
  await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const remove = async (r: { id: string; name: string }, shot?: string) => {
    await page.goto(`/admin/restaurants/${r.id}`);
    await page.getByRole("button", { name: `Supprimer ${r.name}` }).click();
    const dialog = page.getByRole("dialog", { name: `Supprimer ${r.name} ?` });
    const confirm = dialog.getByRole("button", { name: "Supprimer définitivement" });
    // Le bouton reste grisé tant que le mot n'est pas tapé en entier.
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("suppr");
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("textbox").fill("supprimer");
    await expect(confirm).toBeEnabled();
    if (shot) await page.screenshot({ path: shots(shot) });
    await confirm.click();
    return dialog;
  };

  // Commande en cours : refusé, rien n'est effacé.
  const blocked = await remove(veteran, "1-confirmation");
  await expect(blocked.getByText("Ce restaurant a une commande en cours")).toBeVisible();
  await page.screenshot({ path: shots("2-refus-commande-en-cours") });
  await blocked.getByRole("button", { name: "Annuler" }).click();
  await admin.patch(`/admin/orders/${order.id}`, { status: "CANCELLED", cancellationReason: "Test suppression" });

  for (const r of [fresh, veteran]) {
    await remove(r);
    await expect(page).toHaveURL(/\/admin\/restaurants$/);
    await expect(page.getByText(r.name)).toHaveCount(0);
  }

  // Disparu pour les clients, accès du gérant fermé, la commande garde le nom du restaurant.
  await expect(api.get(`/restaurants/${veteran.slug}`)).rejects.toThrow(/404/);
  await expect(veteranApi.get("/restaurant/me")).rejects.toThrow(/401/);
  const kept = await admin.get<{ restaurant: { name: string } }>(`/admin/orders/${order.id}`);
  expect(kept.restaurant.name).toBe(veteran.name);
});
