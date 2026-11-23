import { request as playwrightRequest, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uid, uniquePhone } from "./fixtures";

// Transport scolaire : un parent abonne son enfant (trajets tous les jours pour que le test tombe un jour de
// trajet), le directeur vérifie un conducteur Course Zed pour les enfants, valide la demande avec ce conducteur
// attitré et enregistre le paiement du mois ; le conducteur fait l'aller (je pars, pris en charge, remise avec le
// code de l'école : un faux code est refusé) ; le parent voit chaque étape. Un étudiant s'abonne aussi.

const API = `http://localhost:${API_PORT}/api`;
const shots = (name: string) => `test-results/school/${name}.png`;

function png(): string {
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
  ihdr.writeUInt32BE(32, 0);
  ihdr.writeUInt32BE(32, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Array.from({ length: 32 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(96, 120)]));
  const file = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${file.toString("base64")}`;
}

async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("abonnement écolier : demande du parent, conducteur vérifié, paiement, trajet avec code de remise", async ({ actor, admin, newDriver, ip }) => {
  test.setTimeout(300_000);
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const call = async <T>(method: string, path: string, token?: string, data?: unknown): Promise<{ status: number; body: T }> => {
    const res = await ctx.fetch(`${API}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, data });
    const text = await res.text();
    return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
  };
  async function customer(name: string) {
    const phone = uniquePhone();
    const { body } = await call<{ devCode: string }>("POST", "/customer/otp/request", undefined, { phone });
    const session = await call<{ token: string; customer: { phone: string; name: string | null } }>("POST", "/customer/otp/verify", undefined, { phone, code: body.devCode, name, acceptTerms: true });
    const page = await actor();
    await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token: session.body.token, ...session.body.customer, hasPin: true });
    return { page, token: session.body.token };
  }

  // Conducteur Course Zed actif : livreur indépendant inscrit au mode Zed, pièces ajoutées par l'équipe, dossier validé.
  const driver = await newDriver();
  const { body: otp } = await call<{ devCode: string }>("POST", "/livreur/otp/request", undefined, { phone: driver.phone });
  const driverToken = (await call<{ token: string }>("POST", "/livreur/otp/verify", undefined, { phone: driver.phone, code: otp.devCode })).body.token;
  expect((await call("POST", "/livreur/zed/apply", driverToken, { plate: `TG-${uid().slice(0, 4).toUpperCase()}-EC`, acceptTerms: true })).status).toBe(201);
  await admin.put(`/admin/drivers/${driver.id}/documents/SELFIE`, { photo: png() });
  await admin.put(`/admin/drivers/${driver.id}/documents/ID_CARD`, { photo: png(), issuedAt: "2022-01-10", expiresAt: "2032-01-09" });
  await admin.post(`/admin/zed/drivers/${driver.id}/review`, { decision: "APPROVE" });

  const childName = `Kossi ${uid().slice(0, 5)}`;
  const parent = await customer("Afi Mensah");
  let passId = "";

  try {
    await test.step("parent : demande d'abonnement écolier", async () => {
      const page = parent.page;
      await page.goto("/app/ecole");
      await expect(page.getByText("La maison, l'école, et retour")).toBeVisible();
      await page.getByRole("button", { name: "Nouvel abonnement" }).click();
      await page.getByLabel("Nom et prénom de l'élève").fill(childName);
      await page.getByLabel("Classe (facultatif)").fill("CM1");
      await page.getByLabel("Nom de l'école").fill("École primaire de Tokoin");
      await page.getByLabel("Adresse de l'école (quartier, repère)").fill("Tokoin, près du marché");
      await page.getByLabel("Adresse de la maison (quartier, repère)").fill("Bè, portail bleu près de l'église");
      // Samedi et dimanche cochés aussi : le test tombe toujours un jour de trajet.
      for (const day of ["Samedi", "Dimanche"]) await page.getByRole("checkbox", { name: day }).check();
      for (const day of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) {
        await page.getByLabel(`Aller le ${day.toLowerCase()}`).fill("06:30");
        await page.getByLabel(`Retour le ${day.toLowerCase()}`).fill("17:00");
      }
      await page.getByLabel("Nom", { exact: true }).fill("Yao Mensah");
      await page.getByLabel("Téléphone", { exact: true }).fill("90 11 22 33");
      await page.getByLabel("Santé : allergies, traitement (facultatif)").fill("Allergie aux arachides");
      await expect(page.getByText(/30\s000 FCFA par mois/)).toBeVisible();
      await settle(page);
      await page.screenshot({ path: shots("1-parent-demande"), fullPage: true });
      await page.getByRole("button", { name: "Envoyer la demande" }).click();
      const row = page.getByRole("link", { name: new RegExp(childName) });
      await expect(row).toBeVisible();
      await expect(row.getByText("En attente de validation")).toBeVisible();
      await row.click();
      await expect(page.getByText("Demande envoyée")).toBeVisible();
      passId = page.url().split("/").pop()!;
      await expect(page.getByText("Code de l'école")).toBeVisible();
    });

    // Le conducteur n'est pas encore vérifié pour les enfants : l'API refuse de l'attribuer.
    await expect(admin.post(`/admin/school/passes/${passId}/approve`, { driverId: driver.id })).rejects.toThrow(/409.*vérifié pour le transport d'enfants/);

    const desk = await actor({ desktop: true });
    await test.step("directeur : vérifie le conducteur, valide la demande et encaisse le mois", async () => {
      await desk.goto("/admin/connexion#secours");
      await expect(desk.getByLabel("Adresse e-mail")).toBeHidden();
      await desk.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
      await desk.getByRole("button", { name: "Se connecter", exact: true }).click();
      await expect(desk).toHaveURL(/\/admin$/);
      await desk.goto("/admin/ecole?onglet=conducteurs");
      await expect(desk.getByRole("heading", { name: "Transport scolaire" })).toBeVisible();
      const row = desk.locator("tr", { hasText: driver.name });
      await row.getByRole("button", { name: "Vérifié pour les enfants" }).click();
      await expect(row.getByText("Vérifié", { exact: true })).toBeVisible();
      await desk.screenshot({ path: shots("2-admin-conducteurs"), fullPage: true });

      await desk.goto(`/admin/ecole/${passId}`);
      await expect(desk.getByRole("heading", { name: new RegExp(childName) })).toBeVisible();
      await desk.getByLabel("Conducteur vérifié pour les enfants").selectOption(driver.id);
      await desk.screenshot({ path: shots("3-admin-validation"), fullPage: true });
      await desk.getByRole("button", { name: "Valider l'abonnement" }).click();
      await expect(desk.getByText("En cours", { exact: true })).toBeVisible();
      await desk.getByRole("button", { name: "Enregistrer le paiement" }).click();
      await expect(desk.getByText("Payé", { exact: true })).toBeVisible();
      await desk.screenshot({ path: shots("4-admin-abonnement"), fullPage: true });
    });

    const codes = await admin.get<{ schoolCode: string; homeCode: string }>(`/admin/school/passes/${passId}`);

    await test.step("conducteur : trajet aller, faux code refusé, remise avec le code de l'école", async () => {
      const page = await actor({ geolocation: { latitude: 6.1319, longitude: 1.2228 } });
      await page.addInitScript((s) => localStorage.setItem("zedeka.driver", JSON.stringify(s)), { token: driverToken, name: driver.name, phone: driver.phone });
      await page.goto("/livreur");
      await expect(page.getByRole("link", { name: /Transport scolaire : 2 trajet\(s\) aujourd'hui/ })).toBeVisible();
      await page.getByRole("link", { name: /Transport scolaire/ }).click();
      const trip = page.locator("li", { hasText: "Aller : Maison" });
      await expect(trip.getByText(childName)).toBeVisible();
      await expect(trip.getByText("Allergie aux arachides")).toBeVisible();
      await settle(page);
      await page.screenshot({ path: shots("5-conducteur-trajets"), fullPage: true });
      await trip.getByRole("button", { name: "Je pars" }).click();
      await expect(trip.getByText("Conducteur en route")).toBeVisible();
      await trip.getByRole("button", { name: `${childName} est pris(e) en charge` }).click();
      await expect(trip.getByText("Pris en charge")).toBeVisible();
      const wrong = codes.schoolCode === "1111" ? "2222" : "1111";
      await trip.getByLabel("Code de remise donné par l'école").fill(wrong);
      await trip.getByRole("button", { name: "Valider la remise" }).click();
      await expect(page.getByText(/Code de remise incorrect/)).toBeVisible();
      await trip.getByLabel("Code de remise donné par l'école").fill(codes.schoolCode);
      await page.screenshot({ path: shots("6-conducteur-code"), fullPage: true });
      await trip.getByRole("button", { name: "Valider la remise" }).click();
      await expect(trip.getByText("Arrivé", { exact: true })).toBeVisible();
    });

    await test.step("parent : aller fait, absence signalée pour demain", async () => {
      const page = parent.page;
      await page.goto(`/app/ecole/${passId}`);
      await expect(page.getByText("Conducteur attitré", { exact: true })).toBeVisible();
      await expect(page.getByText(driver.name)).toBeVisible();
      await expect(page.getByText("Arrivé", { exact: true })).toBeVisible();
      await expect(page.getByText(codes.schoolCode)).toBeVisible();
      await settle(page);
      await page.screenshot({ path: shots("7-parent-suivi"), fullPage: true });
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await page.getByLabel("Jour", { exact: true }).fill(tomorrow);
      await page.getByRole("button", { name: "Signaler l'absence" }).click();
      await expect(page.getByText("Absence enregistrée.")).toBeVisible();
      await expect(page.locator("span", { hasText: /^Toute la journée$/ })).toBeVisible();
    });

    await test.step("le conducteur ne voit pas les codes ; un autre client ne voit pas l'abonnement", async () => {
      const mine = await call<{ trips: Record<string, unknown>[]; passes: Record<string, unknown>[] }>("GET", "/livreur/school", driverToken);
      expect(mine.body.trips.length).toBeGreaterThan(0);
      expect(JSON.stringify(mine.body)).not.toContain("schoolCode");
      expect(JSON.stringify(mine.body)).not.toContain("homeCode");
      const other = await customer("Ama Lawson");
      expect((await call("GET", `/customer/school/passes/${passId}`, other.token)).status).toBe(404);
    });

    await test.step("étudiant : abonnement aller seul, sans code de remise", async () => {
      const student = await customer("Komi Agbeko");
      const res = await call<{ id: string }>("POST", "/customer/school/passes", student.token, {
        kind: "STUDENT",
        riderName: "Komi Agbeko",
        schoolName: "Université de Lomé",
        schoolAddress: "Campus nord",
        homeAddress: "Adidogomé, près de la station",
        schedule: { "1": { go: "07:30" }, "3": { go: "09:00" } },
        emergencyName: "Mawuli Agbeko",
        emergencyPhone: "91 22 33 44",
      });
      expect(res.status).toBe(201);
      const detail = await call<{ monthlyFee: number; homeCode: string | null; kind: string }>("GET", `/customer/school/passes/${res.body.id}`, student.token);
      expect(detail.body).toMatchObject({ kind: "STUDENT", monthlyFee: 15000, homeCode: null });
      await student.page.goto("/app/ecole");
      await expect(student.page.getByText("Université de Lomé")).toBeVisible();
      await admin.post(`/admin/school/passes/${res.body.id}/status`, { status: "REJECTED", note: "Fin du test" });
    });
  } finally {
    if (passId) await admin.post(`/admin/school/passes/${passId}/status`, { status: "ENDED", note: "Fin du test" }).catch(() => {});
    await ctx.dispose();
  }
});
