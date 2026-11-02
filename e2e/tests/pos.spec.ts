import { expect, test, uniquePhone } from "./fixtures";

const shots = (name: string) => `test-results/caisse/${name}.png`;
const TABLET = { width: 1280, height: 800 };

// Mode caisse de l'espace restaurant : seules les commandes à accepter et à traiter sont à l'écran, en trois
// affichages au choix (tableau, file unique, caisse). Une nouvelle commande s'affiche en grand ; le reste est
// rangé dans « Plus », et le mode choisi s'ouvre directement à la prochaine visite.
test("mode caisse : nouvelle commande en grand, trois affichages, étapes en un geste", async ({ actor, admin, api, newRestaurant, newDriver, restaurantApi, driverApi }) => {
  test.setTimeout(300_000);
  const restaurant = await newRestaurant();
  for (const [i, m] of [
    { category: "Plats", name: "Poulet braisé entier", price: 6000 },
    { category: "Plats", name: "Akoumé sauce gombo", price: 2000 },
    { category: "Boissons", name: "Jus de gingembre", price: 700 },
  ].entries()) {
    restaurant.items.push(await admin.post(`/admin/restaurants/${restaurant.id}/items`, { ...m, sortOrder: 10 + i }));
  }
  const [riz, fufu, bissap, poulet, akoume, gingembre] = restaurant.items;
  const r = await restaurantApi(restaurant);
  const tables = await r.post<{ number: number; token: string }[]>("/restaurant/tables", { count: 8 });

  // L'API publique ne renvoie que le code : l'identifiant vient de la liste du restaurant.
  const order = async (body: Record<string, unknown>, items: [typeof riz, number][]) => {
    const { code } = await api.post<{ code: string }>("/orders", {
      acceptTerms: true,
      restaurantSlug: restaurant.slug,
      customerPhone: `+228${uniquePhone().replace(/\s/g, "")}`,
      paymentMethod: "CASH",
      items: items.map(([item, quantity]) => ({ menuItemId: item.id, quantity })),
      ...body,
    });
    const [found] = await r.get<{ id: string; code: string }[]>(`/restaurant/orders?q=${code}`);
    return { id: found.id, code };
  };
  const delivery = { fulfillment: "DELIVERY", latitude: restaurant.latitude + 0.01, longitude: restaurant.longitude + 0.008, address: "Bè, près du marché" };
  const status = (id: string, s: string, extra: Record<string, unknown> = {}) => r.post(`/restaurant/orders/${id}/status`, { status: s, ...extra });

  // Déjà en cours : acceptée, en cuisine, prêtes (livraison avec livreur, retrait, table).
  const accepted = await order({ ...delivery, customerName: "Serge B." }, [[akoume, 1], [gingembre, 1]]);
  const cooking1 = await order({ fulfillment: "PICKUP", customerName: "Mariam S." }, [[riz, 2], [bissap, 2]]);
  const cooking2 = await order({ ...delivery, customerName: "Kodjo A." }, [[poulet, 1], [fufu, 1]]);
  const ready1 = await order({ ...delivery, customerName: "Fatou C." }, [[riz, 3], [bissap, 3]]);
  const ready2 = await order({ fulfillment: "PICKUP", customerName: "Paul N." }, [[poulet, 1]]);
  const ready3 = await order({ tableToken: tables[6].token, customerName: "Table 7" }, [[fufu, 2], [gingembre, 2]]);
  await status(accepted.id, "CONFIRMED");
  await status(cooking1.id, "PREPARING", { prepMinutes: 15 });
  await status(cooking2.id, "PREPARING", { prepMinutes: 25 });
  for (const o of [ready1, ready2, ready3]) {
    await status(o.id, "PREPARING", { prepMinutes: 10 });
    await status(o.id, "READY");
  }
  // Un livreur accepte la course de la commande prête : le restaurant le voit arriver.
  const driver = await newDriver({ online: true });
  await admin.patch(`/admin/orders/${ready1.id}`, { driverId: driver.id });
  const d = await driverApi(driver);
  const { offers } = await d.get<{ offers: { id: string }[] }>("/livreur/current");
  await d.post(`/livreur/assignments/${offers[0].id}/accept`);

  // Les nouvelles, à accepter.
  const tableOrder = await order({ tableToken: tables[3].token, customerName: "Table 4" }, [[poulet, 1], [akoume, 2], [gingembre, 2]]);
  const newDelivery = await order({ ...delivery, customerName: "Aïcha K.", note: "Pas d'oignons s'il vous plaît" }, [[riz, 2], [fufu, 1], [bissap, 2]]);

  const panel = await actor({ desktop: true });
  await panel.setViewportSize(TABLET);
  await panel.goto("/restaurant/connexion");
  await panel.getByPlaceholder("E-mail").fill(restaurant.email);
  await panel.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await panel.getByRole("button", { name: "Se connecter" }).click();
  await expect(panel).toHaveURL(/\/restaurant$/);
  // Le lien « Mode caisse » est dans le menu et en haut du tableau de bord (ici caché par l'alarme du mode complet).
  await expect(panel.getByRole("link", { name: "Mode caisse" }).first()).toBeAttached();
  await panel.goto("/restaurant/caisse");

  await test.step("la plus ancienne nouvelle commande s'affiche en grand", async () => {
    const alert = panel.getByRole("alertdialog", { name: "Nouvelle commande" });
    await expect(alert.getByText(tableOrder.code)).toBeVisible();
    await expect(alert.getByText("1 autre(s) commande(s) attendent aussi.")).toBeVisible();
    await panel.screenshot({ path: shots("1-nouvelle-commande") });
    await alert.getByRole("button", { name: "Voir le tableau" }).click();
    await expect(alert).toBeHidden();
  });

  await test.step("tableau cuisine : nouvelles, en cuisine, prêtes", async () => {
    await expect(panel.getByRole("region", { name: "Nouvelles" }).getByText(newDelivery.code)).toBeVisible();
    await expect(panel.getByRole("region", { name: "En cuisine" }).getByText(cooking2.code)).toBeVisible();
    await expect(panel.getByRole("region", { name: "Prêtes" }).getByText(`${driver.name} vient la chercher`)).toBeVisible();
    // Avant l'acceptation, ni livreur ni téléphone.
    await expect(panel.getByRole("region", { name: "Nouvelles" }).getByText("Livreur et téléphone visibles après acceptation")).toBeVisible();
    await panel.screenshot({ path: shots("2-tableau-tablette") });
  });

  await test.step("une commande avance d'une étape en un geste", async () => {
    const card = panel.getByTestId("pos-card").filter({ hasText: accepted.code });
    await card.getByRole("button", { name: "Lancer la préparation" }).click();
    await expect(card.getByRole("button", { name: "Commande prête" })).toBeVisible();
    const fresh = panel.getByTestId("pos-card").filter({ hasText: newDelivery.code });
    await fresh.getByRole("button", { name: "30 min" }).click();
    await fresh.getByRole("button", { name: "Accepter" }).click();
    await expect(panel.getByRole("region", { name: "En cuisine" }).getByText(newDelivery.code)).toBeVisible();
    expect((await api.get(`/orders/${newDelivery.code}`)).status).toBe("PREPARING");
  });

  await test.step("le reste est dans « Plus », avec le choix de l'affichage", async () => {
    await panel.getByRole("button", { name: "Plus" }).click();
    const menu = panel.getByRole("dialog", { name: "Plus" });
    await expect(menu.getByRole("link", { name: /Carte/ })).toBeVisible();
    await panel.screenshot({ path: shots("3-menu-plus") });
    await menu.getByRole("radio", { name: /File unique/ }).click();
    await expect(panel.getByRole("tab", { name: /À accepter/ })).toBeVisible();
    await panel.screenshot({ path: shots("4-file-a-accepter") });
    await panel.getByRole("tab", { name: /À traiter/ }).click();
    await expect(panel.getByTestId("pos-row").first()).toBeVisible();
    await panel.screenshot({ path: shots("5-file-a-traiter") });

    await panel.getByRole("button", { name: "Plus" }).click();
    await menu.getByRole("radio", { name: /Caisse/ }).click();
    await expect(panel.getByRole("heading", { name: `Commande ${tableOrder.code}` })).toBeVisible();
    await panel.screenshot({ path: shots("6-caisse-tablette") });
  });

  await test.step("le mode caisse s'ouvre directement, jusqu'au retour au mode complet", async () => {
    await panel.goto("/restaurant");
    await expect(panel).toHaveURL(/\/restaurant\/caisse$/);
    await expect(panel.getByRole("heading", { name: `Commande ${tableOrder.code}` })).toBeVisible();
    await panel.getByRole("button", { name: "Plus" }).click();
    await panel.getByRole("button", { name: /Passer en mode complet/ }).click();
    await expect(panel).toHaveURL(/\/restaurant$/);
    await panel.reload();
    await expect(panel.getByRole("link", { name: "Mode caisse" }).first()).toBeAttached();
    await expect(panel).toHaveURL(/\/restaurant$/);
  });

  await test.step("sur téléphone, les colonnes deviennent des onglets", async () => {
    const phone = await actor();
    await phone.goto("/restaurant/connexion");
    await phone.getByPlaceholder("E-mail").fill(restaurant.email);
    await phone.getByPlaceholder("Mot de passe").fill(restaurant.password);
    await phone.getByRole("button", { name: "Se connecter" }).click();
    await expect(phone).toHaveURL(/\/restaurant$/);
    await phone.goto("/restaurant/caisse");
    await phone.getByRole("alertdialog", { name: "Nouvelle commande" }).getByRole("button", { name: "Voir le tableau" }).click();
    await expect(phone.getByRole("tab", { name: /Nouvelles/ })).toBeVisible();
    await phone.screenshot({ path: shots("7-tableau-telephone-nouvelles") });
    await phone.getByRole("tab", { name: /En cuisine/ }).click();
    await expect(phone.getByRole("region", { name: "En cuisine" }).getByText(cooking1.code)).toBeVisible();
    await phone.screenshot({ path: shots("8-tableau-telephone-cuisine") });
  });
});
