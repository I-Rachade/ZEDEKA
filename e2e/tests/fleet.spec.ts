import { deflateSync } from "node:zlib";
import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uid, type Driver } from "./fixtures";

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

// Pièces, plaque et parc de motos : le livreur indépendant ajoute sa photo, sa pièce d'identité et sa plaque ;
// le salarié prend une moto du parc pour passer en ligne ; le directeur voit qui roule avec quelle moto.
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
    await test.step("indépendant : pièces manquantes, puis photo, pièce d'identité et plaque", async () => {
      const page = await actor();
      await asDriver(page, freelance, await token(freelance));
      await page.goto("/livreur");
      await expect(page.getByRole("link", { name: /Complétez vos pièces/ })).toBeVisible();
      await page.screenshot({ path: shots("1-accueil-pieces-manquantes") });
      await page.getByRole("link", { name: /Complétez vos pièces/ }).click();
      await expect(page.getByRole("heading", { name: "Mes pièces" })).toBeVisible();
      await expect(page.getByText("2 à fournir")).toBeVisible();
      await page.getByLabel("Photo de profil", { exact: true }).setInputFiles({ name: "moi.png", mimeType: "image/png", buffer: png(120, 80, 60) });
      await expect(page.getByText("1 à fournir")).toBeVisible();
      await page.getByLabel("Pièce d'identité", { exact: true }).setInputFiles({ name: "cni.png", mimeType: "image/png", buffer: png(30, 90, 160) });
      await expect(page.getByText("Complet")).toBeVisible();
      await page.getByPlaceholder("Plaque, ex. TG-1234-AB").fill("tg-4821-ab");
      await page.getByRole("button", { name: "Enregistrer" }).first().click();
      await expect(page.getByText("Plaque enregistrée.")).toBeVisible();
      await page.getByLabel("Photo de la moto", { exact: true }).setInputFiles({ name: "moto.png", mimeType: "image/png", buffer: png(200, 40, 40) });
      await expect(page.getByText("✓ Photo de la moto")).toBeVisible();
      await page.getByRole("heading", { name: "Mes pièces" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: shots("2-profil-pieces") });
      await page.getByRole("heading", { name: "Ma moto" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: shots("2b-profil-moto") });
      await page.goto("/livreur");
      await expect(page.getByRole("link", { name: /Complétez vos pièces/ })).toHaveCount(0);
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

    await test.step("directeur : la moto est sur la route avec le salarié, les pièces sont dans la fiche du livreur", async () => {
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
      await expect(fl.getByRole("img", { name: "Pièce d'identité" })).toBeVisible();
      await expect(fl.getByText("TG-4821-AB")).toBeVisible();
      await fl.scrollIntoViewIfNeeded();
      await fl.screenshot({ path: shots("6-admin-livreur-pieces") });
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
