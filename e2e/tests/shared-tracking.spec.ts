import { expect, test, uniquePhone } from "./fixtures";

// Suivi partagé : une personne sans compte ni appli ouvre le lien de suivi et voit la carte et le livreur en route,
// jamais son numéro ; dans l'appli, l'onglet Commandes suit une livraison en tapant son code.
const SHOTS = process.env.E2E_SHOTS;

test("lien de suivi partagé et suivi par code depuis l'onglet Commandes", async ({ admin, api, actor, newRestaurant, newDriver, restaurantApi, driverApi }) => {
  test.setTimeout(180_000);
  const restaurant = await newRestaurant();
  const r = await restaurantApi(restaurant);
  const customerPhone = `+228${uniquePhone().replace(/\s/g, "")}`;
  const { code } = await api.post<{ code: string }>("/orders", {
    acceptTerms: true,
    restaurantSlug: restaurant.slug,
    customerName: "Afi K.",
    customerPhone,
    paymentMethod: "CASH",
    fulfillment: "DELIVERY",
    latitude: restaurant.latitude + 0.02,
    longitude: restaurant.longitude + 0.015,
    address: "Bè, près du marché",
    items: [{ menuItemId: restaurant.items[0].id, quantity: 1 }],
  });
  const [found] = await r.get<{ id: string }[]>(`/restaurant/orders?q=${code}`);
  await r.post(`/restaurant/orders/${found.id}/status`, { status: "PREPARING", prepMinutes: 10 });
  await r.post(`/restaurant/orders/${found.id}/status`, { status: "READY" });
  const driver = await newDriver({ online: true });
  await admin.patch(`/admin/orders/${found.id}`, { driverId: driver.id });
  const d = await driverApi(driver);
  const { offers } = await d.get<{ offers: { id: string }[] }>("/livreur/current");
  await d.post(`/livreur/assignments/${offers[0].id}/accept`);
  await d.post(`/livreur/orders/${found.id}/status`, { status: "PICKED_UP" });
  await d.post("/livreur/location", { latitude: restaurant.latitude + 0.008, longitude: restaurant.longitude + 0.006, orderId: found.id });

  await test.step("une personne sans compte ouvre le lien : carte, livreur, aucun numéro", async () => {
    const guest = await actor();
    await guest.goto(`/commande/${code}`);
    await expect(guest.getByText("Suivi partagé : vous voyez l'avancement et le trajet du livreur, sans ses coordonnées.")).toBeVisible();
    await expect(guest.locator(".leaflet-container")).toBeVisible();
    await expect(guest.getByText(driver.name.split(" ")[0], { exact: true })).toBeVisible();
    await expect(guest.getByRole("heading", { name: /Arrivée vers/ })).toBeVisible();
    // Ni le numéro du livreur, ni celui du client, ni l'adresse écrite.
    const text = await guest.locator("body").innerText();
    expect(text).not.toContain(driver.phone.replace(/\s/g, "").slice(-6));
    expect(text).not.toContain(customerPhone.slice(-6));
    expect(text).not.toContain("Bè, près du marché");
    if (SHOTS) await guest.screenshot({ path: `${SHOTS}/1-lien-partage.png` });
  });

  await test.step("dans l'appli, l'onglet Commandes suit une livraison avec son code", async () => {
    const app = await actor();
    await app.goto("/app/commandes");
    const field = app.getByLabel("Suivre une livraison avec son code", { exact: true });
    await field.fill("zd-0000-0000");
    await app.getByRole("button", { name: "Suivre", exact: true }).click();
    await expect(app.getByText("Aucune livraison ne correspond à ce code.")).toBeVisible();
    // Minuscules et espaces acceptés.
    await field.fill(code.toLowerCase().replace(/-/g, " "));
    if (SHOTS) await app.screenshot({ path: `${SHOTS}/2-onglet-commandes.png` });
    await app.getByRole("button", { name: "Suivre", exact: true }).click();
    await expect(app).toHaveURL(new RegExp(`/commande/${code}$`));
    await expect(app.locator(".leaflet-container")).toBeVisible();
    if (SHOTS) await app.screenshot({ path: `${SHOTS}/3-suivi-par-code.png` });
  });
});
