import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/services/${name}.png`;

async function setState(boss: Page, name: string, state: "Ouvert" | "Bientôt" | "Caché") {
  const group = boss.getByRole("radiogroup", { name: `État de ${name}` });
  await group.getByRole("radio", { name: state }).click();
  await expect(group.getByRole("radio", { name: state })).toHaveAttribute("aria-checked", "true");
  await boss.waitForTimeout(400); // fin de l'animation des boutons avant une capture
}

// Captures propres : sans le badge de next dev, une fois l'accueil chargé.
async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function openSheet(page: Page) {
  await page.goto("/app");
  await settle(page);
  await page.getByRole("button", { name: "Services" }).click();
  return page.getByRole("dialog", { name: "Que voulez-vous faire ?" });
}

// Bouton « Services » au milieu de la barre de l'appli client : chaque module (colis, course Zed, courses, lessive,
// ménage…) s'ouvre, s'annonce (« Bientôt ») ou se cache dans l'admin, sans toucher aux autres.
test("le directeur active les modules un par un et le client voit la feuille Services suivre", async ({ page, actor, admin }) => {
  test.setTimeout(300_000);

  const boss = await actor({ desktop: true });
  // Page admin entière dans la fenêtre : l'en-tête fixe ne recouvre pas la capture.
  await boss.setViewportSize({ width: 1280, height: 1250 });
  await test.step("page Services de l'admin : colis ouvert, le reste caché", async () => {
    await boss.goto("/admin/connexion");
    await boss.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.getByRole("link", { name: "Services" }).click();
    await expect(boss).toHaveURL(/\/admin\/services$/);
    await settle(boss);
    // Un service pas encore construit ne peut pas être ouvert.
    await expect(boss.getByRole("radiogroup", { name: "État de Lessive" }).getByRole("radio", { name: "Ouvert" })).toBeDisabled();
    await setState(boss, "Course Zed", "Caché");
    await boss.screenshot({ path: shots("01-admin-depart") });
  });

  await test.step("mode « livraison et moto seulement » : colis et course Zed ouverts", async () => {
    await setState(boss, "Course Zed", "Ouvert");
    await boss.screenshot({ path: shots("02-admin-livraison-et-moto") });

    await page.goto("/app");
    await settle(page);
    const button = page.getByRole("button", { name: "Services" });
    await expect(button).toBeVisible();
    await page.screenshot({ path: shots("03-client-accueil-bouton-services") });
    const sheet = await openSheet(page);
    await expect(sheet.getByRole("link", { name: /Envoyer un colis/ })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Une course pour moi/ })).toBeVisible();
    await expect(sheet.getByText("Courses et services")).toHaveCount(0);
    await page.screenshot({ path: shots("04-client-feuille-livraison-et-moto") });
  });

  await test.step("le directeur annonce courses, lessive et ménage : tuiles « Bientôt » non cliquables", async () => {
    for (const name of ["Courses", "Lessive", "Ménage"]) await setState(boss, name, "Bientôt");
    await boss.screenshot({ path: shots("05-admin-services-annonces") });

    const sheet = await openSheet(page);
    await expect(sheet.getByText("Courses et services")).toBeVisible();
    await expect(sheet.locator('[aria-disabled="true"]', { hasText: "Lessive" })).toBeVisible();
    await expect(sheet.getByRole("link", { name: /Lessive/ })).toHaveCount(0);
    await page.screenshot({ path: shots("06-client-feuille-avec-bientot") });
  });

  await test.step("la recherche trouve aussi les services (« linge » → Lessive)", async () => {
    await page.goto("/app/recherche");
    await settle(page);
    await page.getByRole("searchbox").fill("linge");
    const found = page.getByRole("region", { name: "Services" });
    await expect(found.getByText("Lessive")).toBeVisible();
    await expect(found.getByText("Bientôt")).toBeVisible();
    await page.screenshot({ path: shots("07-client-recherche-service") });
  });

  await test.step("ordre de la feuille : la lessive monte en tête des services", async () => {
    const up = () => boss.locator("li", { has: boss.getByRole("radiogroup", { name: "État de Lessive" }) }).getByRole("button", { name: "Monter" });
    const position = async () => (await admin.get<{ code: string }[]>("/admin/services")).findIndex((m) => m.code === "LAUNDRY");
    // Deux crans : au-dessus du gaz (caché) puis des courses.
    await up().click();
    await expect.poll(position).toBe(3);
    await up().click();
    await expect.poll(position).toBe(2);
    const sheet = await openSheet(page);
    const tiles = sheet.locator("ul li");
    await expect(tiles.first()).toContainText("Lessive");
  });

  await test.step("colis coupé : la feuille ne le propose plus, la page colis est fermée et l'API refuse", async () => {
    await setState(boss, "Colis", "Caché");
    const sheet = await openSheet(page);
    await expect(sheet.getByRole("link", { name: /Envoyer un colis/ })).toHaveCount(0);
    await expect(sheet.getByRole("link", { name: /Une course pour moi/ })).toBeVisible();
    await page.screenshot({ path: shots("08-client-feuille-sans-colis") });
    await page.goto("/colis");
    await settle(page);
    await expect(page.getByRole("heading", { name: "L'envoi de colis est fermé pour le moment." })).toBeVisible();
    await page.screenshot({ path: shots("09-client-colis-ferme") });
    const res = await page.request.post(`http://localhost:${API_PORT}/api/parcels`, {
      data: {
        acceptTerms: true,
        customerName: "Kofi Test",
        customerPhone: "90 00 00 01",
        paymentMethod: "CASH",
        pickupAddress: "Bè Kpota",
        address: "Agoè Nyivé",
        recipientName: "Ama",
        recipientPhone: "90 00 00 02",
        parcelCategoryId: "x",
        weightKg: 1,
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toBe("L'envoi de colis est fermé pour le moment.");
  });

  await test.step("tout caché : plus de bouton du milieu, l'appli garde les repas", async () => {
    await setState(boss, "Course Zed", "Caché");
    for (const name of ["Courses", "Lessive", "Ménage"]) await setState(boss, name, "Caché");
    await boss.screenshot({ path: shots("10-admin-tout-cache") });
    await page.goto("/app");
    await settle(page);
    await expect(page.getByRole("link", { name: "Commandes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Services" })).toHaveCount(0);
    await page.screenshot({ path: shots("11-client-sans-bouton") });
  });

  // Remise à l'état de départ pour les autres tests (colis ouvert).
  await admin.patch("/admin/services/PARCEL", { state: "ON" });
  await admin.put("/admin/services/order", { codes: ["PARCEL", "RIDE", "ERRAND", "GAS", "LAUNDRY", "CLEANING", "REPAIR"] });
});
