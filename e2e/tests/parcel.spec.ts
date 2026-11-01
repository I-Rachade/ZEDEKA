import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Colis avec position du destinataire : l'expéditeur crée un lien, le destinataire l'ouvre sur son téléphone
// et partage sa position, le prix de livraison est alors calculé sur la distance entre les deux points.

// Tarif colis des réglages par défaut : 1 000 FCFA minimum, 200 FCFA par km, arrondi aux 50 FCFA.
// 0,072° de latitude ≈ 8,0 km, soit 1 600 FCFA.
const PICKUP = { latitude: 6.13, longitude: 1.22 };
const DROP = { latitude: PICKUP.latitude + 0.072, longitude: PICKUP.longitude };
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("colis : le destinataire partage sa position, le prix suit la distance", async ({ page, context, actor, api }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(PICKUP);

  await page.goto("/colis");
  await test.step("type, poids et taille du colis", async () => {
    await page.getByRole("button", { name: "Documents" }).click();
    await page.getByRole("button", { name: "Moins de 1 kg" }).click();
    await page.getByRole("button", { name: /^Petit enveloppe/ }).click();
    await page.getByRole("button", { name: "Continuer" }).click();
  });

  let link = "";
  await test.step("expéditeur, puis lien de position pour le destinataire", async () => {
    await page.getByLabel("Votre nom").fill("Yawa Dossou");
    await page.getByLabel("Votre téléphone").fill(uniquePhone());
    await page.getByRole("button", { name: /Ma position actuelle/ }).click();
    await expect(page.locator("#colis-pickupPos").getByText("Position enregistrée")).toBeVisible();

    await page.getByLabel("Nom du destinataire").fill("Komi Ahadji");
    await page.getByLabel("Téléphone du destinataire").fill(uniquePhone());
    await page.getByRole("button", { name: /^Demander/ }).click();
    await page.getByRole("button", { name: "Créer le lien" }).click();
    link = (await page.locator("span.font-mono", { hasText: "/position/" }).textContent())!.trim();
    expect(link).toContain("/position/");
  });

  await test.step("le destinataire ouvre le lien et envoie sa position", async () => {
    const recipient = await actor({ geolocation: DROP });
    await recipient.goto(new URL(link).pathname);
    await expect(recipient.getByRole("heading", { name: "Yawa vous envoie un colis" })).toBeVisible();
    await recipient.getByRole("button", { name: "Partager ma position" }).click();
    await recipient.getByRole("button", { name: "Envoyer ma position" }).click();
    await expect(recipient.getByRole("heading", { name: "Position envoyée, merci" })).toBeVisible();
  });

  await test.step("la position arrive chez l'expéditeur et fixe le prix", async () => {
    await expect(page.getByText(/Position reçue du destinataire/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/8 km du retrait/)).toBeVisible();
    await page.getByRole("button", { name: "Continuer" }).click();
    await expect(page.getByText("Livraison (8 km)")).toBeVisible();
    await expect(page.getByText(fcfa(1600)).first()).toBeVisible();
    await page.getByRole("checkbox", { name: /J'ai 18 ans ou plus/ }).check();
    await page.getByRole("button", { name: "Demander la livraison · espèces" }).click();
  });

  const code = await createdCode(page);
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ type: "PARCEL", status: "PENDING", deliveryFee: 1600 });
});
