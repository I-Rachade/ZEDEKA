import { request as playwrightRequest, type Page } from "@playwright/test";
import { ADMIN_PASSWORD, API_PORT } from "../env.mjs";
import { expect, test, uniquePhone } from "./fixtures";

// Les cinq services du bouton « Services » (courses, gaz et eau, lessive, ménage, dépannage), de bout en bout :
// le directeur les ouvre et règle un tarif, donne des services à un livreur, les clients font leurs demandes, le
// livreur les prend et les termine, le client note, l'équipe attribue ou annule depuis l'admin.

const API = `http://localhost:${API_PORT}/api`;
const shots = (name: string) => `test-results/service-requests/${name}.png`;

async function settle(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await page.waitForLoadState("networkidle").catch(() => {});
}

test("les cinq services : demande du client, mission du livreur, suivi et admin", async ({ actor, admin, newDriver, ip }) => {
  test.setTimeout(420_000);
  const ctx = await playwrightRequest.newContext({ extraHTTPHeaders: { "cf-connecting-ip": ip } });
  const call = async <T>(method: string, path: string, token?: string, data?: unknown): Promise<{ status: number; body: T }> => {
    const res = await ctx.fetch(`${API}${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, data });
    const text = await res.text();
    return { status: res.status(), body: (text ? JSON.parse(text) : null) as T };
  };
  // Compte client prêt (code SMS affiché en mode test), session posée sur l'appareil.
  async function customer(name: string) {
    const phone = uniquePhone();
    const { body } = await call<{ devCode: string }>("POST", "/customer/otp/request", undefined, { phone });
    const session = await call<{ token: string; customer: { phone: string; name: string | null } }>("POST", "/customer/otp/verify", undefined, { phone, code: body.devCode, name, acceptTerms: true });
    const page = await actor();
    await page.addInitScript((s) => localStorage.setItem("zedeka.customer", JSON.stringify(s)), { token: session.body.token, ...session.body.customer, hasPin: true });
    return { page, token: session.body.token };
  }

  const codes = ["ERRAND", "GAS", "LAUNDRY", "CLEANING", "REPAIR"];
  // Remise à l'état de départ, même si une étape échoue : services cachés pour les autres tests.
  const reset = async () => {
    for (const code of codes) await admin.patch(`/admin/services/${code}`, { state: "OFF" }).catch(() => {});
    await ctx.dispose();
  };
  try {
  const boss = await actor({ desktop: true });
  await boss.setViewportSize({ width: 1280, height: 1400 });

  await test.step("admin : les cinq services ouverts, tarif de la lessive réglé", async () => {
    for (const code of codes) await admin.patch(`/admin/services/${code}`, { state: "ON" });
    await boss.goto("/admin/connexion");
    await boss.getByRole("button", { name: "Utiliser le mot de passe du directeur" }).click();
    await boss.getByLabel("Mot de passe").fill(ADMIN_PASSWORD);
    await boss.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(boss).toHaveURL(/\/admin$/);
    await boss.goto("/admin/services");
    await settle(boss);
    const laundry = boss.getByRole("form", { name: "Tarif de Lessive" });
    await laundry.getByLabel("Prix par sac").fill("3000");
    await laundry.getByRole("button", { name: "Enregistrer" }).click();
    await expect.poll(async () => (await admin.get<{ code: string; price: { unit: number } | null }[]>("/admin/services")).find((m) => m.code === "LAUNDRY")?.price?.unit).toBe(3000);
    await boss.screenshot({ path: shots("01-admin-services-ouverts-et-tarifs") });
  });

  const driver = await newDriver();
  await test.step("admin : le livreur reçoit les services Gaz, Courses et Ménage", async () => {
    await boss.goto("/admin/services/demandes");
    await settle(boss);
    await boss.getByLabel("Rechercher un livreur", { exact: true }).fill(driver.name);
    const group = boss.getByRole("group", { name: `Services de ${driver.name}` });
    for (const name of ["Gaz et eau", "Courses pour moi", "Ménage"]) {
      await group.getByRole("button", { name: new RegExp(name) }).click();
      await expect(group.getByRole("button", { name: new RegExp(name) })).toHaveAttribute("aria-pressed", "true");
    }
    await boss.screenshot({ path: shots("02-admin-prestataire-services") });
  });

  const ama = await customer("Ama Kpodar");
  const kofi = await customer("Kofi Mensah");
  const yawa = await customer("Yawa Agbeko");

  await test.step("client : la feuille Services propose les cinq services", async () => {
    await ama.page.goto("/app");
    await settle(ama.page);
    await ama.page.getByRole("button", { name: "Services" }).click();
    const sheet = ama.page.getByRole("dialog", { name: "Que voulez-vous faire ?" });
    for (const name of ["Courses", "Gaz et eau", "Lessive", "Ménage", "Dépannage"]) await expect(sheet.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await ama.page.screenshot({ path: shots("03-client-feuille-cinq-services") });
  });

  let gasId = "";
  await test.step("gaz et eau : 2 bouteilles de 12 kg, estimation 1 500 FCFA", async () => {
    const page = ama.page;
    await page.getByRole("dialog", { name: "Que voulez-vous faire ?" }).getByRole("link", { name: /Gaz et eau/ }).click();
    await expect(page).toHaveURL(/\/app\/services\/GAS$/);
    await settle(page);
    await page.getByRole("radio", { name: /Gaz 12 kg/ }).click();
    await page.getByRole("button", { name: "Plus" }).click();
    await page.getByLabel("Adresse").fill("Bè Kpota, près de la pharmacie");
    await expect(page.getByTestId("estimate")).toHaveText(/1\s500 FCFA/);
    await page.screenshot({ path: shots("04-client-formulaire-gaz") });
    await page.getByRole("button", { name: /Envoyer la demande/ }).click();
    await expect(page).toHaveURL(/\/app\/services\/demande\//);
    gasId = page.url().split("/").pop() ?? "";
    await expect(page.getByTestId("status")).toHaveText("Recherche d'un prestataire");
    await page.screenshot({ path: shots("05-client-suivi-recherche") });
  });

  await test.step("courses pour moi : liste et budget", async () => {
    const page = ama.page;
    await page.goto("/app/services/ERRAND");
    await settle(page);
    await page.getByLabel("Votre liste de courses").fill("5 kg de riz\n1 L d'huile\n2 boîtes de tomate");
    await page.getByRole("button", { name: /20\s000 FCFA/ }).click();
    await page.getByLabel("Boutique ou marché (facultatif)").fill("Grand Marché");
    await page.getByLabel("Adresse").fill("Tokoin Wuiti, face à la station");
    await page.screenshot({ path: shots("06-client-formulaire-courses") });
    await page.getByRole("button", { name: /Envoyer la demande/ }).click();
    await expect(page.getByTestId("status")).toHaveText("Recherche d'un prestataire");
  });

  await test.step("lessive : 3 sacs avec repassage, créneau demain", async () => {
    const page = kofi.page;
    await page.goto("/app/services/LAUNDRY");
    await settle(page);
    await page.getByRole("button", { name: "Plus" }).click();
    await page.getByLabel("Avec repassage").check();
    await page.getByLabel("Adresse").fill("Agoè Nyivé, maison jaune");
    await expect(page.getByTestId("estimate")).toHaveText(/9\s500 FCFA/);
    await page.screenshot({ path: shots("07-client-formulaire-lessive") });
    await page.getByRole("button", { name: /Envoyer la demande/ }).click();
    await expect(page.getByTestId("status")).toHaveText("Recherche d'un prestataire");
  });

  await test.step("ménage : bureau, 4 heures", async () => {
    const page = kofi.page;
    await page.goto("/app/services/CLEANING");
    await settle(page);
    await page.getByRole("radio", { name: /Bureau/ }).click();
    await page.getByRole("button", { name: "Plus" }).nth(1).click();
    await page.getByLabel("Adresse").fill("Nyékonakpoè, immeuble Kodjo");
    await expect(page.getByTestId("estimate")).toHaveText(/8\s000 FCFA/);
    await page.screenshot({ path: shots("08-client-formulaire-menage") });
    await page.getByRole("button", { name: /Envoyer la demande/ }).click();
    await expect(page.getByTestId("status")).toHaveText("Recherche d'un prestataire");
  });

  await test.step("dépannage : plomberie, description obligatoire", async () => {
    const page = yawa.page;
    await page.goto("/app/services/REPAIR");
    await settle(page);
    await page.getByLabel("Décrivez le problème").fill("Le robinet de la cuisine fuit depuis hier soir");
    await page.getByLabel("Adresse").fill("Adidogomé, rue du marché");
    await page.screenshot({ path: shots("09-client-formulaire-depannage") });
    await page.getByRole("button", { name: /Envoyer la demande/ }).click();
    await expect(page.getByTestId("status")).toHaveText("Recherche d'un prestataire");
  });

  const rider = await actor();
  let riderToken = "";
  await test.step("livreur : missions à prendre (seulement ses services)", async () => {
    const { body } = await call<{ devCode: string }>("POST", "/livreur/otp/request", undefined, { phone: driver.phone });
    const session = await call<{ token: string }>("POST", "/livreur/otp/verify", undefined, { phone: driver.phone, code: body.devCode });
    riderToken = session.body.token;
    await rider.addInitScript((s) => localStorage.setItem("zedeka.driver", JSON.stringify(s)), { token: riderToken, name: driver.name, phone: driver.phone });
    await rider.goto("/livreur");
    await settle(rider);
    await expect(rider.getByRole("link", { name: /Missions de service/ })).toBeVisible();
    await rider.screenshot({ path: shots("10-livreur-accueil-missions") });
    await rider.getByRole("link", { name: /Missions de service/ }).click();
    const available = rider.getByRole("region", { name: "À prendre" });
    await expect(available.getByText("2 bouteilles de gaz 12 kg")).toBeVisible();
    await expect(available.getByText(/Ménage 4 h/)).toBeVisible();
    // Lessive et dépannage : pas dans son profil.
    await expect(available.getByText(/Lessive/)).toHaveCount(0);
    await expect(available.getByText(/Plomberie/)).toHaveCount(0);
    await rider.screenshot({ path: shots("11-livreur-missions-a-prendre") });
  });

  await test.step("livreur : accepte le gaz, en route, sur place, termine avec le prix du gaz", async () => {
    const card = rider.getByRole("listitem").filter({ hasText: "2 bouteilles de gaz 12 kg" });
    await card.getByRole("button", { name: "Accepter la mission" }).click();
    const mine = rider.getByRole("region", { name: "En cours" }).getByRole("listitem").filter({ hasText: "2 bouteilles de gaz 12 kg" });
    await expect(mine.getByRole("link", { name: /Ama Kpodar/ })).toBeVisible();
    await rider.screenshot({ path: shots("12-livreur-mission-acceptee") });

    await ama.page.goto(`/app/services/demande/${gasId}`);
    await expect(ama.page.getByTestId("status")).toHaveText("Prestataire trouvé");
    await expect(ama.page.getByText(driver.name)).toBeVisible();
    await ama.page.screenshot({ path: shots("13-client-suivi-prestataire-trouve") });

    await mine.getByRole("button", { name: "Je suis en route" }).click();
    await expect(mine.getByText("En route", { exact: true })).toBeVisible();
    await mine.getByRole("button", { name: "Je suis sur place, je commence" }).click();
    await mine.getByRole("button", { name: "Terminer la mission" }).click();
    await mine.getByLabel("Prix du gaz ou de l'eau").fill("13000");
    await expect(mine.getByText(/Total à encaisser : 14\s500 FCFA/)).toBeVisible();
    await rider.screenshot({ path: shots("14-livreur-fin-de-mission") });
    await mine.getByRole("button", { name: "Confirmer la fin" }).click();
    await expect(rider.getByRole("region", { name: "Terminées" }).getByText("2 bouteilles de gaz 12 kg")).toBeVisible();
  });

  await test.step("client : demande terminée, total à payer, note", async () => {
    const page = ama.page;
    await page.reload();
    await expect(page.getByTestId("status")).toHaveText("Terminée");
    await expect(page.getByTestId("total")).toHaveText(/14\s500 FCFA/);
    await page.screenshot({ path: shots("15-client-suivi-termine") });
    await page.getByRole("radio", { name: "5 sur 5" }).click();
    await page.getByRole("button", { name: "Envoyer la note" }).click();
    await expect(page.getByLabel("5 sur 5").last()).toBeVisible();
    await page.goto("/app/commandes");
    await settle(page);
    await page.getByRole("tab", { name: /Services/ }).click();
    await expect(page.getByRole("tabpanel", { name: "Services" }).getByText("2 bouteilles de gaz 12 kg")).toBeVisible();
    await page.screenshot({ path: shots("16-client-commandes-services") });
  });

  await test.step("admin : attribuer la lessive, annuler le dépannage", async () => {
    // La lessive n'est dans le profil de personne : l'équipe ajoute le service au livreur puis l'attribue.
    await admin.patch(`/admin/service-providers/${driver.id}`, { codes: ["ERRAND", "GAS", "CLEANING", "LAUNDRY"] });
    await boss.goto("/admin/services/demandes");
    await settle(boss);
    const laundry = boss.getByRole("listitem").filter({ hasText: "Lessive : 3 sacs" });
    await laundry.getByRole("combobox").selectOption({ label: driver.name });
    await laundry.getByRole("button", { name: "Attribuer" }).click();
    await expect(boss.getByRole("listitem").filter({ hasText: "Lessive : 3 sacs" }).getByText("Prestataire trouvé")).toBeVisible();
    boss.once("dialog", (d) => d.accept("Aucun plombier disponible ce jour"));
    await boss.getByRole("listitem").filter({ hasText: "Plomberie" }).getByRole("button", { name: "Annuler" }).click();
    await expect(boss.getByRole("listitem").filter({ hasText: "Plomberie" })).toHaveCount(0);
    await boss.screenshot({ path: shots("17-admin-demandes") });
    await yawa.page.reload();
    await expect(yawa.page.getByTestId("status")).toHaveText("Annulée");
    await yawa.page.screenshot({ path: shots("18-client-demande-annulee") });
  });

  await test.step("garde-fous de l'API", async () => {
    // Ménage fermé : nouvelle demande refusée.
    await admin.patch("/admin/services/CLEANING", { state: "OFF" });
    const closed = await call<{ error: string }>("POST", "/customer/service-requests", yawa.token, {
      module: "CLEANING",
      address: "Bè Kpota",
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString().slice(0, 11) + "10:00:00Z",
      details: { hours: 2 },
    });
    expect(closed.status).toBe(409);
    // Formulaire invalide : message clair.
    const bad = await call<{ error: string }>("POST", "/customer/service-requests", yawa.token, { module: "GAS", address: "Bè Kpota", details: { product: "PETROLE", quantity: 1 } });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe("Choisissez gaz ou eau");
    // Créneau hors horaires.
    const late = await call<{ error: string }>("POST", "/customer/service-requests", yawa.token, {
      module: "REPAIR",
      address: "Bè Kpota",
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString().slice(0, 11) + "22:00:00Z",
      details: { trade: "OTHER", problem: "La porte ne ferme plus" },
    });
    expect(late.body.error).toBe("Créneaux de 7 h à 19 h");
    // Pas de demande d'un autre client.
    const other = await call("GET", `/customer/service-requests/${gasId}`, yawa.token);
    expect(other.status).toBe(404);
    // Un livreur sans le service ne peut pas prendre une mission.
    const open = await admin.get<{ requests: { id: string; module: string }[] }>("/admin/service-requests?status=open&module=ERRAND");
    await admin.patch(`/admin/service-providers/${driver.id}`, { codes: ["GAS"] });
    const refused = await call("POST", `/livreur/missions/${open.requests[0].id}/accept`, riderToken);
    expect(refused.status).toBe(403);
  });

  } finally {
    await reset();
  }
});
