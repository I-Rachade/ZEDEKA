"use client";

import { useState } from "react";
import { PhotoField } from "@/components/panel/MenuEditor";
import { adminFetch, adminUploadImage, type AdminBanner, type AdminMenuItem } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { button, buttonGhost, Card, input } from "../ui";

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;
const text = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());

// Bannières en haut de la page du commerce : image, ou vidéo avec son image d'attente, qui peut mener à un
// plat ou un article de la carte. 8 au plus, dans l'ordre choisi ici.
export default function BannersBlock({ restaurantId, banners, items, run, reload }: { restaurantId: string; banners: AdminBanner[]; items: AdminMenuItem[]; run: Run; reload: () => Promise<unknown> | void }) {
  const [kind, setKind] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(0); // remet le formulaire à zéro après un ajout
  const t = useT();
  const upload = (photo: Blob) => adminUploadImage(`/restaurants/${restaurantId}/images`, photo);
  const patch = (id: string, body: Partial<AdminBanner>) =>
    run(async () => {
      await adminFetch(`/banners/${id}`, { method: "PATCH", body });
      await reload();
    });
  const itemName = (id: string | null) => items.find((i) => i.id === id)?.name;

  return (
    <Card title="Bannières">
      <p className="mb-3 text-sm text-stone-600">{t("Images ou vidéos publicitaires en haut de la page du commerce. Une bannière peut mener à un article de la carte.")}</p>
      {banners.length > 0 && (
        <ul className="mb-3 divide-y divide-stone-100">
          {banners.map((b, i) => (
            <li key={b.id} className={`flex flex-wrap items-center gap-3 py-2 text-sm ${b.active ? "" : "opacity-50"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- image fournie par le commerce */}
              <img src={b.kind === "VIDEO" ? (b.posterUrl ?? "") : b.url} alt="" className="h-12 w-20 rounded bg-stone-100 object-cover" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {b.title || t("Sans titre")} {b.kind === "VIDEO" && <span className="text-xs font-normal text-stone-500">{t("(vidéo)")}</span>}
                </p>
                {b.menuItemId && <p className="text-stone-500">{t("Mène à : {name}", { name: itemName(b.menuItemId) ?? "–" })}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                {i > 0 && (
                  <button type="button" onClick={() => patch(b.id, { position: i - 1 }).then(() => patch(banners[i - 1].id, { position: i }))} className={buttonGhost} aria-label={t("Monter")}>
                    ↑
                  </button>
                )}
                <button type="button" onClick={() => patch(b.id, { active: !b.active })} className={buttonGhost}>
                  {b.active ? t("Masquer") : t("Afficher")}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    run(async () => {
                      await adminFetch(`/banners/${b.id}`, { method: "DELETE" });
                      await reload();
                    })
                  }
                  className="px-2 text-red-700"
                >
                  {t("Supprimer")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {banners.length < 8 && (
        <form
          key={form}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const ok = await run(async () => {
              await adminFetch(`/restaurants/${restaurantId}/banners`, {
                method: "POST",
                body: {
                  kind,
                  url: text(f.get("url")),
                  posterUrl: kind === "VIDEO" ? text(f.get("posterUrl")) || null : null,
                  title: text(f.get("title")),
                  menuItemId: text(f.get("menuItemId")) || null,
                },
              });
              await reload();
            });
            if (ok) setForm((n) => n + 1);
          }}
          className="grid gap-2 border-t border-stone-100 pt-3 text-sm sm:grid-cols-2"
        >
          <select value={kind} onChange={(e) => setKind(e.target.value as "IMAGE" | "VIDEO")} className={input} aria-label={t("Type de bannière")}>
            <option value="IMAGE">{t("Image")}</option>
            <option value="VIDEO">{t("Vidéo")}</option>
          </select>
          <input name="title" maxLength={80} placeholder={t("Titre (facultatif)")} className={input} />
          {kind === "IMAGE" ? (
            <PhotoField name="url" initial={null} upload={upload} onBusy={setUploading} className="sm:col-span-2" />
          ) : (
            <>
              <input name="url" type="url" required placeholder={t("Lien de la vidéo (https://…)")} className={`${input} sm:col-span-2`} />
              <div className="sm:col-span-2">
                <p className="mb-1 font-medium">{t("Image d'attente de la vidéo")}</p>
                <PhotoField name="posterUrl" initial={null} upload={upload} onBusy={setUploading} className="" />
              </div>
            </>
          )}
          <select name="menuItemId" defaultValue="" className={`${input} sm:col-span-2`} aria-label={t("Article lié")}>
            <option value="">{t("Ne mène à aucun article")}</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <button className={`${button} sm:col-span-2`} disabled={uploading}>
            {t("Ajouter la bannière")}
          </button>
        </form>
      )}
    </Card>
  );
}
