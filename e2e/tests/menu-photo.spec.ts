import { expect, test } from "./fixtures";

const shots = (name: string) => `test-results/photo-plat/${name}.png`;

// Le gérant ajoute la photo d'un plat depuis son téléphone (galerie ou appareil photo) : elle est réduite
// dans le navigateur, envoyée, et apparaît sur la carte et chez le client. Un nouveau plat peut aussi partir
// directement avec sa photo.
test("le restaurant charge la photo d'un plat depuis l'appareil", async ({ actor, newRestaurant }) => {
  test.setTimeout(240_000);
  const restaurant = await newRestaurant();
  const owner = await actor();

  // Une « photo » de 1600 × 1200 dessinée dans le navigateur, comme celle d'un téléphone.
  await owner.goto("/restaurant/connexion");
  const dataUrl = await owner.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1600;
    c.height = 1200;
    const g = c.getContext("2d")!;
    const grad = g.createLinearGradient(0, 0, 1600, 1200);
    grad.addColorStop(0, "#f59e0b");
    grad.addColorStop(1, "#b45309");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 1200);
    g.fillStyle = "#fff7ed";
    g.beginPath();
    g.arc(800, 600, 380, 0, Math.PI * 2);
    g.fill();
    return c.toDataURL("image/png");
  });
  const photo = { name: "plat.png", mimeType: "image/png", buffer: Buffer.from(dataUrl.split(",")[1], "base64") };

  await owner.getByPlaceholder("E-mail").fill(restaurant.email);
  await owner.getByPlaceholder("Mot de passe").fill(restaurant.password);
  await owner.getByRole("button", { name: "Se connecter" }).click();
  await expect(owner).toHaveURL(/\/restaurant$/);
  await owner.goto("/restaurant/carte");

  const dish = restaurant.items[0].name;
  await test.step("photo d'un plat existant, avec « Modifier »", async () => {
    const row = owner.locator("li").filter({ hasText: dish }).first();
    await row.getByRole("button", { name: "Modifier" }).click();
    await owner.locator("form").filter({ has: owner.getByRole("button", { name: "Enregistrer", exact: true }) }).locator('input[type="file"]').setInputFiles(photo);
    await expect(owner.getByRole("img", { name: "Photo du plat" }).first()).toBeVisible();
    await expect(owner.getByText("Changer la photo").first()).toBeVisible();
    await owner.screenshot({ path: shots("1-modifier-avec-photo"), fullPage: true });
    await owner.getByRole("button", { name: "Enregistrer", exact: true }).click();
    const img = owner.getByRole("img", { name: `Photo : ${dish}` });
    await expect(img).toBeVisible();
    // La liste affiche la vignette légère, envoyée avec la photo.
    const src = (await img.getAttribute("src"))!;
    expect(src).toMatch(/\/api\/media\/menu-images\/.+\.jpg\?size=thumb$/);
    const res = await owner.request.get(src);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
    expect(res.headers()["x-thumb"]).toBeUndefined();
    // La photo entière est bien servie (et réduite : JPEG).
    const full = await owner.request.get(src.replace("?size=thumb", ""));
    expect(full.status()).toBe(200);
    expect(full.headers()["content-type"]).toBe("image/jpeg");
  });

  await test.step("nouveau plat avec sa photo", async () => {
    const addForm = owner.locator("form").filter({ has: owner.getByRole("button", { name: "Ajouter le plat" }) });
    await addForm.getByPlaceholder("Catégorie (ex. Plats)").fill("Plats");
    await addForm.getByPlaceholder("Nom du plat").fill("Riz gras");
    await addForm.getByPlaceholder("Prix FCFA").fill("1500");
    await addForm.locator('input[type="file"]').setInputFiles(photo);
    await expect(addForm.getByRole("img", { name: "Photo du plat" })).toBeVisible();
    await owner.screenshot({ path: shots("2-nouveau-plat-avec-photo"), fullPage: true });
    await addForm.getByRole("button", { name: "Ajouter le plat" }).click();
    await expect(owner.getByRole("img", { name: "Photo : Riz gras" })).toBeVisible();
    // Le formulaire repart sans photo.
    await expect(addForm.getByText("Sans photo")).toBeVisible();
    await owner.screenshot({ path: shots("3-carte-avec-photos"), fullPage: true });
  });
});
