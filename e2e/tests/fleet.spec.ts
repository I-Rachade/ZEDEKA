import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uid, uniquePhone, type Driver } from "./fixtures";

const shots = (name: string) => `test-results/flotte/${name}.png`;

// Image PNG unie (dégradé), pour les photos envoyées depuis le téléphone.
function png(r: number, g: number, b: number, w = 96, h = 72): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) row.set([Math.min(255, r + y), Math.min(255, g + x / 2), b], 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

async function asDriver(page: Page, d: Driver, token: string) {
  await page.addInitScript((s) => localStorage.setItem("zedeka.driver", JSON.stringify(s)), { token, name: d.name, phone: d.phone });
}

// Pièces, plaque et parc de motos : le livreur indépendant change sa plaque et la photo de sa moto, mais seule
// l'équipe ajoute sa photo de profil et sa pièce d'identité (dans l'admin) ; le salarié prend une moto du parc
// pour passer en ligne ; le directeur voit qui roule avec quelle moto.
test("pièces des livreurs, plaque et parc de motos", async ({ actor, admin, api, newDriver }) => {
  const plate = `TG-${uid().slice(0, 4).toUpperCase()}-ZK`;
  const bike = await admin.post<{ id: string }>("/admin/fleet", { plate, label: "Haojue rouge" });
  const staff = await newDriver({ employment: "STAFF" });
  const freelance = await newDriver();
  const token = async (d: Driver) => {
    const { devCode } = await api.post<{ devCode: string }>("/livreur/otp/request", { phone: d.phone });
    return (await api.post<{ token: string }>("/livreur/otp/verify", { phone: d.phone, code: devCode })).token;
  };

  let staffToken = "";
  try {
    let driverPage: Page | null = null;
    await test.step("indépendant : pièces en lecture seule, il change sa plaque et la photo de sa moto", async () => {
      const page = (driverPage = await actor());
      const freelanceToken = await token(freelance);
      await asDriver(page, freelance, freelanceToken);
      await page.goto("/livreur");
      await expect(page.getByRole("link", { name: /Pièces à fournir/ })).toBeVisible();
      await page.screenshot({ path: shots("1-accueil-pieces-manquantes") });
      await page.getByRole("link", { name: /Pièces à fournir/ }).click();
      await expect(page.getByRole("heading", { name: "Mes pièces" })).toBeVisible();
      await expect(page.getByText("2 à fournir")).toBeVisible();
      await expect(page.getByText(/Votre photo et vos pièces sont ajoutées par l'équipe Zedeka/)).toBeVisible();
      // Plus aucun envoi de la photo de profil ni des pièces depuis l'appli, même en appelant l'API.
      await expect(page.getByLabel("Photo de profil", { exact: true })).toHaveCount(0);
      const refused = await fetch(`http://localhost:${API_PORT}/api/livreur/documents/SELFIE`, {
        method: "PUT",
        headers: { authorization: `Bearer ${freelanceToken}`, "content-type": "application/json" },
        body: JSON.stringify({ photo: `data:image/png;base64,${png(1, 2, 3).toString("base64")}` }),
      });
      expect(refused.status).toBe(403);
      await page.getByPlaceholder("Plaque, ex. TG-1234-AB").fill("tg-4821-ab");
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await expect(page.getByText("Plaque enregistrée.")).toBeVisible();
      await page.getByLabel("Photo de la moto", { exact: true }).setInputFiles({ name: "moto.png", mimeType: "image/png", buffer: png(200, 40, 40) });
      await expect(page.getByText("✓ Photo de la moto")).toBeVisible();
      await page.getByRole("heading", { name: "Ma moto" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: shots("2b-profil-moto") });
    });

    await test.step("salarié : choisit une moto du parc pour passer en ligne", async () => {
      const page = await actor();
      staffToken = await token(staff);
      await asDriver(page, staff, staffToken);
      await page.goto("/livreur");
      await page.getByRole("switch", { name: "Hors ligne" }).click();
      const picker = page.getByRole("dialog", { name: "Quelle moto prenez-vous ?" });
      await expect(picker.getByRole("radio", { name: new RegExp(plate) })).toBeVisible();
      await picker.getByRole("radio", { name: new RegExp(plate) }).click();
      await page.screenshot({ path: shots("3-choix-moto-du-parc") });
      await picker.getByRole("button", { name: "Prendre cette moto et passer en ligne" }).click();
      await expect(page.getByRole("switch", { name: "En ligne" })).toBeVisible();
      await expect(page.getByText(plate)).toBeVisible();
      await page.screenshot({ path: shots("4-accueil-moto-prise") });
    });

    await test.step("directeur : la moto est sur la route avec le salarié, il ajoute les pièces du livreur", async () => {
      const page = await actor({ desktop: true });
      await page.goto("/admin/connexion");
      await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
      await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Se connecter", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await page.goto("/admin/motos");
      const row = page.locator("li", { hasText: plate });
      await expect(row.getByText(staff.name)).toBeVisible();
      await page.screenshot({ path: shots("5-admin-parc-motos"), fullPage: true });
      await page.goto("/admin/livreurs");
      const fl = page.locator("li", { hasText: freelance.name });
      await expect(fl.getByText("TG-4821-AB")).toBeVisible();
      await fl.getByRole("button", { name: "Ajouter les pièces" }).click();
      const form = fl.getByRole("form", { name: `Pièces de ${freelance.name}` });
      await form.getByLabel(/Photo de profil/).setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png(120, 80, 60) });
      await form.getByLabel(/Pièce d'identité/).setInputFiles({ name: "cni.png", mimeType: "image/png", buffer: png(30, 90, 160) });
      await form.getByLabel("Délivrée le").fill("2022-03-14");
      await form.getByLabel("Expire le").fill("2032-03-13");
      await fl.scrollIntoViewIfNeeded();
      await fl.screenshot({ path: shots("6a-admin-ajout-pieces") });
      await form.getByRole("button", { name: "Enregistrer les pièces" }).click();
      await expect(form).toHaveCount(0);
      await expect(fl.getByRole("img", { name: "Pièce d'identité" })).toBeVisible();
      await expect(fl.getByText("Pièce d'identité valable jusqu'au 13 mars 2032")).toBeVisible();
      await fl.screenshot({ path: shots("6-admin-livreur-pieces") });
    });

    await test.step("indépendant : ses pièces apparaissent dans son profil, sans pouvoir les changer", async () => {
      const page = driverPage!;
      await page.goto("/livreur/profil");
      await expect(page.getByText("Complet")).toBeVisible();
      await expect(page.getByText("✓ Pièce d'identité")).toBeVisible();
      await expect(page.getByText("Pièce d'identité délivrée le 14 mars 2022, expire le 13 mars 2032.")).toBeVisible();
      await expect(page.getByText("Touchez pour changer")).toHaveCount(1); // la photo de la moto seulement
      await page.locator("section", { has: page.getByRole("heading", { name: "Mes pièces" }) }).screenshot({ path: shots("2-profil-pieces") });
      await page.goto("/livreur");
      await expect(page.getByRole("link", { name: /Pièces à fournir/ })).toHaveCount(0);
    });

    // Hors ligne : la moto est rendue.
    await test.step("salarié hors ligne : la moto est rendue et redevient libre", async () => {
      const holder = async () => (await admin.get<{ motorbikes: { id: string; driver: { name: string } | null }[] }>("/admin/fleet")).motorbikes.find((b) => b.id === bike.id)?.driver?.name ?? null;
      expect(await holder()).toBe(staff.name);
      const res = await fetch(`http://localhost:${API_PORT}/api/livreur/online`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${staffToken}`, "content-type": "application/json" },
        body: JSON.stringify({ online: false }),
      });
      expect(res.ok).toBe(true);
      expect(await holder()).toBeNull();
    });
  } finally {
    // La base est partagée : la moto quitte le service pour ne pas obliger les autres salariés à en choisir une.
    await admin.post(`/admin/fleet/${bike.id}/release`);
    await admin.patch(`/admin/fleet/${bike.id}`, { active: false });
  }
});

// Conducteur Zed : il s'inscrit sans photo ni pièce ; le directeur les ajoute sur la fiche de sa demande, puis valide.
test("inscription Zed sans pièces, ajoutées par l'équipe avant validation", async ({ actor, admin }) => {
  const name = `Zed ${uid()}`;
  const plate = `TG-${uid().slice(0, 4).toUpperCase()}-ZD`;
  await test.step("conducteur : numéro, nom, plaque et PIN, sans photo", async () => {
    const page = await actor();
    await page.goto("/livreur/zed/inscription");
    await page.getByLabel("Numéro de téléphone").fill(uniquePhone());
    await page.getByRole("button", { name: "Recevoir le code" }).click();
    await page.getByLabel("Nom et prénom").fill(name);
    await page.getByLabel("Plaque de la moto").fill(plate);
    await page.getByLabel("Choisissez votre code PIN").fill("4826");
    await expect(page.getByText(/Apportez votre pièce d'identité à l'équipe Zedeka/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.screenshot({ path: shots("7-inscription-zed"), fullPage: true });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Envoyer mon dossier" }).click();
    await expect(page.getByText(/Passez au bureau Zedeka avec votre pièce d'identité/)).toBeVisible();
  });

  await test.step("directeur : ajoute photo et pièce sur la demande, puis valide", async () => {
    const page = await actor({ desktop: true });
    await page.goto("/admin/connexion");
    await page.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await page.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const pending = await admin.get<{ id: string; name: string }[]>("/admin/zed/drivers?status=PENDING");
    const id = pending.find((d) => d.name === name)?.id;
    expect(id).toBeTruthy();
    await page.goto(`/admin/zed/${id}`);
    await expect(page.getByRole("heading", { name })).toBeVisible();
    // Sans pièces, la validation est refusée.
    await page.getByRole("button", { name: "Valider et ouvrir le mode Zed" }).click();
    await expect(page.getByText(/Dossier incomplet : ajoutez la photo et la pièce d'identité/)).toBeVisible();
    const form = page.getByRole("form", { name: `Pièces de ${name}` });
    await form.getByLabel(/Photo de profil/).setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png(120, 80, 60) });
    await form.getByLabel(/Pièce d'identité/).setInputFiles({ name: "cni.png", mimeType: "image/png", buffer: png(30, 90, 160) });
    await form.getByLabel("Délivrée le").fill("2021-06-01");
    await form.getByLabel("Expire le").fill("2031-05-31");
    await form.getByRole("button", { name: "Enregistrer les pièces" }).click();
    await expect(page.getByRole("img", { name: "Pièce d'identité" })).toBeVisible();
    await page.screenshot({ path: shots("8-admin-zed-pieces"), fullPage: true });
    await page.getByRole("button", { name: "Valider et ouvrir le mode Zed" }).click();
    await expect(page.getByText(/Dossier incomplet/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Valider et ouvrir le mode Zed" })).toHaveCount(0);
  });
});
