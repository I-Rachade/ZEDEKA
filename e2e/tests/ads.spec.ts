import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD } from "../env.mjs";
import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/publicites/${name}.png`;

// Bannière 1600 × 700 dessinée dans le navigateur, comme une affiche préparée par un annonceur.
async function banner(page: Page, from: string, to: string, title: string, sub: string) {
  const dataUrl = await page.evaluate(
    ([from, to, title, sub]) => {
      const c = document.createElement("canvas");
      c.width = 1600;
      c.height = 700;
      const g = c.getContext("2d")!;
      const grad = g.createLinearGradient(0, 0, 1600, 700);
      grad.addColorStop(0, from);
      grad.addColorStop(1, to);
      g.fillStyle = grad;
      g.fillRect(0, 0, 1600, 700);
      g.fillStyle = "rgba(255,255,255,0.18)";
      g.beginPath();
      g.arc(1350, 520, 360, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#fff";
      g.font = "bold 120px sans-serif";
      g.fillText(title, 90, 330);
      g.font = "64px sans-serif";
      g.fillText(sub, 90, 450);
      return c.toDataURL("image/png");
    },
    [from, to, title, sub],
  );
  return { name: "banniere.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };
}

// L'accueil de l'appli client garde une place pour la publicité entre « Livrer à » et les cases Repas / Colis.
// L'admin y ajoute des bannières (image envoyée depuis l'appareil, lien, ordre) qui défilent en carrousel.
test("l'admin publie des bannières qui défilent sur l'accueil du client", async ({ page, actor, admin }) => {
  test.setTimeout(240_000);

  await test.step("sans publicité, une bannière Zedeka garde la place, au-dessus de Repas et Colis", async () => {
    const live = await admin.get<unknown[]>("/admin/ads");
    await page.goto("/app");
    const tile = page.getByRole("link", { name: /Repas/ }).first();
    await expect(tile).toBeVisible();
    if (live.length === 0) {
      const house = page.getByText("Vos repas et vos colis, livrés dans toute la ville");
      await expect(house).toBeVisible();
      // La bannière est entre le sélecteur de zone et les cases.
      const [b, t] = await Promise.all([house.boundingBox(), tile.boundingBox()]);
      expect(b!.y).toBeLessThan(t!.y);
      await page.screenshot({ path: shots("1-accueil-sans-pub") });
    }
  });

  const boss = await actor({ desktop: true });
  await test.step("le directeur ajoute deux publicités dans l'admin", async () => {
    await boss.goto("/admin/connexion");
    await boss.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.getByRole("link", { name: "Publicités" }).click();
    await expect(boss).toHaveURL(/\/admin\/publicites$/);

    const ads = [
      { title: "Chez Ama -20 %", link: "/app/recherche", image: await banner(boss, "#f59e0b", "#c2410c", "Chez Ama -20 %", "Tout le week-end sur Zedeka") },
      { title: "Colis express", link: "/colis", image: await banner(boss, "#0e7c4a", "#0e2a1e", "Colis express", "Livré en 45 min dans Lomé") },
    ];
    for (const ad of ads) {
      const form = boss.locator("form").last();
      await form.locator('input[type="file"]').setInputFiles(ad.image);
      await expect(form.getByText("Changer l'image")).toBeVisible();
      // Conseils de format, et contrôle de la taille de l'image choisie.
      await expect(form.getByText("Image actuelle : 1600 × 700 px. Format parfait.")).toBeVisible();
      await form.screenshot({ path: shots("4-admin-format-image") });
      await form.getByLabel(/Nom/).fill(ad.title);
      await form.getByLabel(/Lien au toucher/).fill(ad.link);
      await form.getByRole("button", { name: "Ajouter la publicité" }).click();
      await expect(boss.getByText(ad.title, { exact: true })).toBeVisible();
    }
    await boss.screenshot({ path: shots("3-admin-publicites"), fullPage: true });
  });

  await test.step("le client voit le carrousel ; toucher la bannière ouvre son lien", async () => {
    await page.goto("/app");
    const carousel = page.getByRole("region", { name: "Publicités" });
    await expect(carousel.getByRole("img", { name: "Chez Ama -20 %" })).toBeVisible();
    await expect(carousel.getByRole("button", { name: "Voir la publicité 2" })).toBeVisible();
    await page.screenshot({ path: shots("2-accueil-carrousel") });
    await carousel.getByRole("button", { name: "Voir la publicité 2" }).click();
    await expect(carousel.getByRole("button", { name: "Voir la publicité 2" })).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: shots("2b-accueil-carrousel-2") });
    await carousel.getByRole("link", { name: /Colis express/ }).click();
    await expect(page).toHaveURL(/\/colis/);
  });

  await test.step("une publicité masquée disparaît de l'accueil", async () => {
    const row = boss.locator("li", { hasText: "Colis express" });
    await row.getByRole("button", { name: "Masquer" }).click();
    await expect(row.getByText("Masquée")).toBeVisible();
    await page.goto("/app");
    const carousel = page.getByRole("region", { name: "Publicités" });
    await expect(carousel.getByRole("img", { name: "Chez Ama -20 %" })).toBeVisible();
    await expect(carousel.getByRole("img", { name: "Colis express" })).toHaveCount(0);
  });
});
