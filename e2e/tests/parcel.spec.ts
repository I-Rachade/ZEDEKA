import { createdCode, expect, test, uniquePhone } from "./fixtures";

// Colis avec position du destinataire : l'expéditeur crée un lien, le destinataire l'ouvre sur son téléphone
// et partage sa position, le prix de livraison est alors calculé sur la distance entre les deux points.

// Tarif colis des réglages par défaut (27/11/2026) : 500 FCFA minimum, 100 FCFA par km, arrondi aux 50 FCFA.
// 0,072° de latitude ≈ 8,0 km, soit 800 FCFA.
const PICKUP = { latitude: 6.13, longitude: 1.22 };
const DROP = { latitude: PICKUP.latitude + 0.072, longitude: PICKUP.longitude };
const fcfa = (n: number) => new RegExp(`${n.toLocaleString("fr-FR").replace(/\s/g, "\\s")}\\sFCFA`);

test("colis : le destinataire partage sa position, le prix suit la distance", async ({ page, context, actor, api }) => {
  test.setTimeout(180_000);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation(PICKUP);

  await page.goto("/colis");
  await test.step("une question par écran : départ, puis destinataire", async () => {
    // Départ : la position du téléphone est proposée d'office, « C'est ici » suffit.
    await expect(page.getByRole("heading", { name: "D'où part le colis ?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Ma position actuelle/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /^C'est ici/ }).click();

    // Sans nom ni numéro, « Continuer » signale ce qui manque.
    await expect(page.getByRole("heading", { name: "Qui le reçoit ?" })).toBeVisible();
    await page.getByRole("button", { name: /^Continuer/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Il manque 4 informations" })).toBeVisible();
    await page.getByLabel("Nom du destinataire").fill("Komi Ahadji");
    await page.getByLabel("Téléphone du destinataire").fill(uniquePhone());
    await page.getByLabel("Votre nom").fill("Yawa Dossou");
    await page.getByLabel("Votre téléphone").fill(uniquePhone());
    await page.getByRole("button", { name: /^Continuer/ }).click();
  });

  let link = "";
  await test.step("arrivée : lien de position pour le destinataire", async () => {
    await expect(page.getByRole("heading", { name: "Où le livrer ?" })).toBeVisible();
    await page.getByRole("button", { name: /Le destinataire envoie sa position/ }).click();
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
    // Le prix s'affiche en haut dès que les deux points sont connus.
    await expect(page.getByTestId("price-pill")).toHaveText(fcfa(800));
    await page.getByRole("button", { name: /^Continuer/ }).click();

    // Type de colis : une tuile, et l'on passe tout seul au récapitulatif.
    await page.getByRole("button", { name: /Documents/ }).click();
    await expect(page.getByRole("heading", { name: "Tout est bon ?" })).toBeVisible();
    await expect(page.getByText("Livraison (8 km)")).toBeVisible();
    await expect(page.getByText(fcfa(800)).first()).toBeVisible();
    await expect(page.getByText("En envoyant, vous acceptez les")).toBeVisible();
    await page.getByRole("button", { name: /^Trouver un livreur · 800\sFCFA/ }).click();
    await expect(page.getByRole("heading", { name: "C'est envoyé !" })).toBeVisible();
  });

  const code = await createdCode(page);
  const order = await api.get(`/orders/${code}`);
  expect(order).toMatchObject({ type: "PARCEL", status: "PENDING", deliveryFee: 800 });
});
