"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { askConfirm } from "@/components/AlertDialog";
import { card, input, Skeleton, TopBar } from "@/app/app/ui";
import { Icon } from "@/components/panel/icons";
import { shrink } from "@/components/panel/MenuEditor";
import StoreCarousel from "@/components/StoreCarousel";
import { useT } from "@/lib/i18n/client";
import { merchantFetch, merchantUpload, type Banner, type Product } from "@/lib/merchant";

const MAX_BANNERS = 8;
const MAX_VIDEO_MB = 20;
const BANNER_SIDE = 1600;

// Bannières publicitaires de la boutique : images et vidéos en carrousel en haut de sa page. Chaque bannière peut
// mener à un produit. Aperçu en haut, tel que les clients le verront.
export default function BannersPage() {
  const t = useT();
  const [banners, setBanners] = useState<Banner[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [b, p] = await Promise.all([merchantFetch<Banner[]>("/banners"), merchantFetch<Product[]>("/products")]);
    setBanners(b);
    setProducts(p);
  }, []);
  useEffect(() => {
    load().catch((e) => setError((e as Error).message));
  }, [load]);

  async function act(what: string, fn: () => Promise<unknown>) {
    setBusy(what);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addImage(file: File | undefined) {
    if (!file) return;
    await act("image", async () => {
      const url = await merchantUpload("/store/images", await shrink(file, BANNER_SIDE));
      await merchantFetch("/banners", { method: "POST", body: { kind: "IMAGE", url } });
    });
    if (imageInput.current) imageInput.current.value = "";
  }

  async function addVideo(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setError(t("Vidéo trop lourde : {n} Mo au plus. Raccourcissez-la ou réduisez sa qualité.", { n: MAX_VIDEO_MB }));
      return;
    }
    await act("video", async () => {
      const url = await merchantUpload("/store/videos", file);
      // Image d'attente : la première image de la vidéo, prise sur l'appareil (facultative).
      const poster = await videoPoster(file)
        .then((p) => (p ? merchantUpload("/store/images", p) : null))
        .catch(() => null);
      await merchantFetch("/banners", { method: "POST", body: { kind: "VIDEO", url, posterUrl: poster } });
    });
    if (videoInput.current) videoInput.current.value = "";
  }

  const move = (i: number, d: -1 | 1) => {
    if (!banners) return;
    const ids = banners.map((b) => b.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void act("order", () => merchantFetch("/banners/order", { method: "PUT", body: { ids } }));
  };

  const active = banners?.filter((b) => b.active) ?? [];
  const full = (banners?.length ?? 0) >= MAX_BANNERS;
  return (
    <div>
      <TopBar title="Bannières" back="/marchand/produits" />
      <div className="space-y-4 px-4 pb-8 pt-4">
        <section className="space-y-2">
          <p className="text-[12px] uppercase tracking-wide text-stone-500">{t("Aperçu en haut de votre boutique")}</p>
          {active.length ? (
            <StoreCarousel banners={active} />
          ) : (
            <div className="grid aspect-[16/7] place-items-center rounded-[12px] border-2 border-dashed border-stone-300 px-6 text-center text-[14px] text-stone-500">
              {t("Ajoutez des images ou des vidéos pour présenter vos nouveautés et vos promotions.")}
            </div>
          )}
        </section>

        <div className="grid grid-cols-2 gap-2">
          <label className={`${card} card-line flex cursor-pointer flex-col items-center gap-1 p-4 text-center text-[14px] font-semibold ${busy || full ? "pointer-events-none opacity-50" : ""}`}>
            <span className="text-[24px]" aria-hidden="true">
              🖼️
            </span>
            {busy === "image" ? t("Envoi…") : t("Ajouter une image")}
            <input ref={imageInput} type="file" accept="image/*" className="sr-only" onChange={(e) => addImage(e.target.files?.[0])} aria-label={t("Ajouter une image")} />
          </label>
          <label className={`${card} card-line flex cursor-pointer flex-col items-center gap-1 p-4 text-center text-[14px] font-semibold ${busy || full ? "pointer-events-none opacity-50" : ""}`}>
            <span className="text-[24px]" aria-hidden="true">
              🎬
            </span>
            {busy === "video" ? t("Envoi de la vidéo…") : t("Ajouter une vidéo")}
            <input ref={videoInput} type="file" accept="video/mp4,video/webm" className="sr-only" onChange={(e) => addVideo(e.target.files?.[0])} aria-label={t("Ajouter une vidéo")} />
          </label>
        </div>
        <p className="text-[13px] text-stone-500">
          {t("Format conseillé : large (16:7), par exemple 1600 × 700. Vidéo MP4 de {n} Mo au plus, sans le son à l'écran.", { n: MAX_VIDEO_MB })} {t("{n} bannières au plus.", { n: MAX_BANNERS })}
        </p>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {!banners ? (
          <Skeleton rows={2} />
        ) : (
          <ul className="space-y-3">
            {banners.map((b, i) => (
              <li key={b.id} className={`${card} card-line space-y-3 p-3 ${b.active ? "" : "opacity-60"}`}>
                <div className="flex gap-3">
                  <div className="relative h-16 w-[9.2rem] shrink-0 overflow-hidden rounded-[8px] bg-stone-200">
                    {b.kind === "VIDEO" ? (
                      <video src={b.url} poster={b.posterUrl ?? undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- image envoyée par le marchand
                      <img src={b.url} alt="" className="h-full w-full object-cover" />
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] font-semibold text-white">{b.kind === "VIDEO" ? t("Vidéo") : t("Image")}</span>
                  </div>
                  <div className="flex flex-1 flex-col justify-between">
                    <span className="text-[13px] text-stone-500">{t("Bannière {n}", { n: i + 1 })}</span>
                    <span className="flex gap-1">
                      <IconButton label={t("Monter")} disabled={i === 0 || !!busy} onClick={() => move(i, -1)} rotate="-rotate-90" />
                      <IconButton label={t("Descendre")} disabled={i === banners.length - 1 || !!busy} onClick={() => move(i, 1)} rotate="rotate-90" />
                      <button
                        type="button"
                        aria-label={t("Supprimer la bannière {n}", { n: i + 1 })}
                        disabled={!!busy}
                        onClick={async () => {
                          if (await askConfirm(t("Supprimer cette bannière ?"), t("Supprimer"))) void act("delete", () => merchantFetch(`/banners/${b.id}`, { method: "DELETE" }));
                        }}
                        className="grid h-9 w-9 place-items-center rounded-full bg-red-50 text-red-600"
                      >
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </span>
                  </div>
                </div>
                <input
                  className={input}
                  defaultValue={b.title}
                  maxLength={80}
                  placeholder={t("Texte sur la bannière (facultatif)")}
                  aria-label={t("Texte de la bannière {n}", { n: i + 1 })}
                  onBlur={(e) => e.target.value !== b.title && void act("title", () => merchantFetch(`/banners/${b.id}`, { method: "PATCH", body: { title: e.target.value } }))}
                />
                <div className="flex items-center gap-2">
                  <select
                    className={input}
                    value={b.productId ?? ""}
                    aria-label={t("Produit ouvert au toucher")}
                    onChange={(e) => void act("product", () => merchantFetch(`/banners/${b.id}`, { method: "PATCH", body: { productId: e.target.value || null } }))}
                  >
                    <option value="">{t("Au toucher : rien")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {t("Ouvre")} : {p.name}
                      </option>
                    ))}
                  </select>
                  <label className="flex shrink-0 items-center gap-2 text-[14px]">
                    <input type="checkbox" checked={b.active} onChange={(e) => void act("active", () => merchantFetch(`/banners/${b.id}`, { method: "PATCH", body: { active: e.target.checked } }))} className="h-5 w-5 accent-emerald-600" />
                    {t("Affichée")}
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function IconButton({ label, disabled, onClick, rotate }: { label: string; disabled: boolean; onClick: () => void; rotate: string }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid h-9 w-9 place-items-center rounded-full bg-stone-100 text-stone-700 disabled:opacity-30">
      <Icon name="chevron" className={`h-4 w-4 ${rotate}`} />
    </button>
  );
}

// Première image d'une vidéo, en JPEG, pour l'afficher avant la lecture.
async function videoPoster(file: File): Promise<Blob | null> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("poster"));
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 2000);
    });
    const scale = Math.min(1, BANNER_SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    if (!canvas.width || !canvas.height) return null;
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
  } finally {
    URL.revokeObjectURL(url);
  }
}
