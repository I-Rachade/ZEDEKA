"use client";

import { askConfirm } from "@/components/AlertDialog";
import { useEffect, useRef, useState } from "react";
import { fcfa } from "@/lib/api";
import { adminFetch, adminUploadImage } from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { useDebounced } from "@/lib/useDebounced";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

// Nouveautés : courtes vidéos (5 à 7 s) des produits, dans l'onglet « Nouveautés » de l'appli client. Le client
// les fait défiler, les aime, les commente et commande directement le plat ou le produit relié.

type Order = { kind: "DISH" | "PRODUCT" | "LINK"; href: string; price: number | null; seller: string | null; available: boolean } | null;
type Reel = {
  id: string;
  title: string;
  caption: string | null;
  videoUrl: string;
  posterUrl: string | null;
  menuItemId: string | null;
  productId: string | null;
  linkUrl: string | null;
  position: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  likeCount: number;
  commentCount: number;
  targetName: string | null;
  order: Order;
};
type Target = { kind: "DISH" | "PRODUCT"; id: string; name: string; price: number; seller: string; available: boolean };
type AdminComment = { id: string; text: string; hidden: boolean; createdAt: string; author: string; phone: string | null };

const MAX_VIDEO_MB = 20;
const LONGEST_S = 15;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const startOf = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toISOString() : null);
const endOf = (d: string) => (d ? new Date(new Date(`${d}T00:00:00Z`).getTime() + 86_400_000).toISOString() : null);
const endDay = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - 86_400_000).toISOString().slice(0, 10) : "");

function status(r: Reel, t: ReturnType<typeof useT>) {
  const now = Date.now();
  if (!r.active) return { label: t("Masquée"), tone: "bg-stone-200 text-stone-700" };
  if (r.startsAt && new Date(r.startsAt).getTime() > now) return { label: t("Programmée"), tone: "bg-amber-100 text-amber-900" };
  if (r.endsAt && new Date(r.endsAt).getTime() <= now) return { label: t("Terminée"), tone: "bg-stone-200 text-stone-700" };
  return { label: t("En ligne"), tone: "bg-emerald-100 text-emerald-800" };
}

// Durée, format et première image de la vidéo, lus sur l'appareil avant l'envoi.
async function inspect(file: File): Promise<{ duration: number; width: number; height: number; poster: Blob | null }> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("video"));
      setTimeout(() => reject(new Error("timeout")), 10_000);
    });
    const info = { duration: video.duration || 0, width: video.videoWidth, height: video.videoHeight };
    video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 2000);
    });
    const scale = Math.min(1, 1080 / Math.max(video.videoWidth, video.videoHeight, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    let poster: Blob | null = null;
    if (canvas.width && canvas.height) {
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    }
    return { ...info, poster };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function TargetPicker({ value, onChange }: { value: { kind: "DISH" | "PRODUCT"; id: string; label: string } | null; onChange: (v: { kind: "DISH" | "PRODUCT"; id: string; label: string } | null) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim(), 300);
  const [found, setFound] = useState<Target[] | null>(null);

  useEffect(() => {
    if (query.length < 2) return setFound(null);
    let stale = false;
    adminFetch<{ dishes: Omit<Target, "kind">[]; products: Omit<Target, "kind">[] }>(`/reels/targets?q=${encodeURIComponent(query)}`)
      .then((r) => !stale && setFound([...r.dishes.map((d) => ({ ...d, kind: "DISH" as const })), ...r.products.map((p) => ({ ...p, kind: "PRODUCT" as const }))]))
      .catch(() => !stale && setFound([]));
    return () => {
      stale = true;
    };
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{value.kind === "DISH" ? t("Plat") : t("Produit")}</span> · {value.label}
        </span>
        <button type="button" onClick={() => onChange(null)} className={buttonGhost}>
          {t("Changer")}
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Chercher un plat, un produit, un restaurant ou une boutique")} className={input} />
      {found && (
        <ul className="max-h-60 divide-y divide-stone-100 overflow-y-auto rounded-xl border border-stone-200">
          {found.length === 0 && <li className="p-3 text-stone-500">{t("Aucun résultat")}</li>}
          {found.map((f) => (
            <li key={`${f.kind}-${f.id}`}>
              <button
                type="button"
                onClick={() => {
                  onChange({ kind: f.kind, id: f.id, label: `${f.name} (${f.seller})` });
                  setQ("");
                }}
                className="flex w-full items-center gap-2 p-3 text-left hover:bg-stone-50"
              >
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${f.kind === "DISH" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>{f.kind === "DISH" ? t("Plat") : t("Produit")}</span>
                <span className="min-w-0 flex-1 truncate">
                  {f.name} <span className="text-stone-500">· {f.seller}</span>
                </span>
                <span className="text-stone-600">{fcfa(f.price)}</span>
                {!f.available && <span className="text-xs text-red-700">{t("Indisponible")}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReelForm({ reel, nextPosition, onSubmit, onCancel }: { reel?: Reel; nextPosition: number; onSubmit: (body: Partial<Reel>) => Promise<boolean>; onCancel?: () => void }) {
  const t = useT();
  const [videoUrl, setVideoUrl] = useState(reel?.videoUrl ?? "");
  const [posterUrl, setPosterUrl] = useState<string | null>(reel?.posterUrl ?? null);
  const [target, setTarget] = useState<{ kind: "DISH" | "PRODUCT"; id: string; label: string } | null>(
    reel?.menuItemId ? { kind: "DISH", id: reel.menuItemId, label: `${reel.targetName ?? ""} (${reel.order?.seller ?? ""})` } : reel?.productId ? { kind: "PRODUCT", id: reel.productId, label: `${reel.targetName ?? ""} (${reel.order?.seller ?? ""})` } : null,
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; warn: boolean } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(null);
    setNote(null);
    if (file.size > MAX_VIDEO_MB * 1024 * 1024) {
      setUploadError(t("Vidéo trop lourde : {n} Mo au plus. Raccourcissez-la ou réduisez sa qualité.", { n: MAX_VIDEO_MB }));
      return;
    }
    setBusy(true);
    try {
      const info = await inspect(file).catch(() => null);
      if (info && info.duration > LONGEST_S) {
        setUploadError(t("Vidéo trop longue ({s} s) : {max} secondes au plus, 5 à 7 secondes idéalement.", { s: Math.round(info.duration), max: LONGEST_S }));
        return;
      }
      // Vidéo d'iPhone (.mov) : même conteneur que le MP4, envoyée comme telle.
      const body = file.type === "video/mp4" || file.type === "video/webm" ? file : new Blob([file], { type: "video/mp4" });
      const url = await adminUploadImage("/reels/videos", body);
      const poster = info?.poster ? await adminUploadImage("/reels/images", info.poster).catch(() => null) : null;
      setVideoUrl(url);
      setPosterUrl(poster);
      if (info) {
        const portrait = info.height > info.width;
        const ideal = info.duration >= 4.5 && info.duration <= 7.5;
        setNote({
          text: `${t("Vidéo : {s} s, {w} × {h} px.", { s: String(Math.round(info.duration * 10) / 10).replace(".", ","), w: info.width, h: info.height })} ${!portrait ? t("Elle n'est pas verticale : les côtés seront coupés à l'écran.") : !ideal ? t("Idéalement 5 à 7 secondes.") : t("Format parfait.")}`,
          warn: !portrait || !ideal,
        });
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("Envoi impossible"));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const ok = await onSubmit({
          title: String(f.get("title")).trim(),
          caption: String(f.get("caption")).trim() || null,
          videoUrl,
          posterUrl,
          menuItemId: target?.kind === "DISH" ? target.id : null,
          productId: target?.kind === "PRODUCT" ? target.id : null,
          linkUrl: target ? null : String(f.get("linkUrl") ?? "").trim() || null,
          position: Number(f.get("position") || 0),
          startsAt: startOf(String(f.get("startsAt"))),
          endsAt: endOf(String(f.get("endsAt"))),
        });
        if (ok && !reel) {
          form.reset();
          setVideoUrl("");
          setPosterUrl(null);
          setTarget(null);
          setNote(null);
        }
      }}
      className="grid gap-4 text-sm sm:grid-cols-[180px_1fr]"
    >
      <div className="space-y-2">
        {videoUrl ? (
          <video src={videoUrl} poster={posterUrl ?? undefined} muted loop autoPlay playsInline className="aspect-[9/16] w-full rounded-xl bg-black object-cover" />
        ) : (
          <div className="grid aspect-[9/16] w-full place-items-center rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 text-center text-stone-500">
            {t("Vidéo verticale 9:16, 5 à 7 secondes")}
          </div>
        )}
        <label className={`${buttonGhost} block cursor-pointer text-center ${busy ? "pointer-events-none opacity-60" : ""}`}>
          {busy ? t("Envoi de la vidéo…") : videoUrl ? t("Changer la vidéo") : t("Choisir la vidéo")}
          <input ref={fileInput} type="file" accept="video/mp4,video/webm,video/quicktime" className="sr-only" disabled={busy} onChange={(e) => pick(e.target.files?.[0])} />
        </label>
      </div>
      <div className="space-y-3">
        {uploadError && <p className="text-red-700">{uploadError}</p>}
        {note && <p className={note.warn ? "font-medium text-amber-800" : "text-emerald-800"}>{note.text}</p>}
        <div className="space-y-1 rounded-xl bg-emerald-50 p-3 text-emerald-950">
          <p className="font-semibold">{t("Format idéal de la vidéo")}</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>{t("Verticale (1080 × 1920 px, comme une story), 5 à 7 secondes, MP4.")}</li>
            <li>{t("{n} Mo au plus. Le produit bien visible dès la première seconde.", { n: MAX_VIDEO_MB })}</li>
            <li>{t("Laissez le bas de l'image libre : le nom, le prix et « Commander » s'y affichent.")}</li>
          </ul>
        </div>
        <label className="block space-y-1">
          <span className="block text-stone-600">{t("Nom du produit (affiché sur la vidéo)")}</span>
          <input name="title" required minLength={2} maxLength={80} defaultValue={reel?.title} placeholder={t("ex. Poulet braisé")} className={input} />
        </label>
        <label className="block space-y-1">
          <span className="block text-stone-600">{t("Texte court (facultatif)")}</span>
          <input name="caption" maxLength={200} defaultValue={reel?.caption ?? ""} placeholder={t("ex. Nouveau ! Braisé au feu de bois, servi avec de l'alloco")} className={input} />
        </label>
        <div className="space-y-1">
          <span className="block text-stone-600">{t("« Commander » ouvre ce plat ou ce produit")}</span>
          <TargetPicker value={target} onChange={setTarget} />
        </div>
        {!target && (
          <label className="block space-y-1">
            <span className="block text-stone-600">{t("ou un lien (facultatif)")}</span>
            <input name="linkUrl" defaultValue={reel?.linkUrl ?? ""} placeholder={t("/colis ou https://…")} className={input} />
          </label>
        )}
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-1">
            <span className="block text-stone-600">{t("Ordre")}</span>
            <input name="position" type="number" min={0} max={999} defaultValue={reel?.position ?? nextPosition} className={input} />
          </label>
          <label className="space-y-1">
            <span className="block text-stone-600">{t("Du (facultatif)")}</span>
            <input name="startsAt" type="date" defaultValue={day(reel?.startsAt ?? null)} className={input} />
          </label>
          <label className="space-y-1">
            <span className="block text-stone-600">{t("Au (inclus)")}</span>
            <input name="endsAt" type="date" defaultValue={endDay(reel?.endsAt ?? null)} className={input} />
          </label>
        </div>
        <div className="flex gap-2">
          <button className={button} disabled={busy || !videoUrl}>
            {reel ? t("Enregistrer") : t("Publier la vidéo")}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className={buttonGhost}>
              {t("Annuler")}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function Comments({ reel, onChanged }: { reel: Reel; onChanged: () => void }) {
  const t = useT();
  const { data, error, reload } = useAdmin<AdminComment[]>(`/reels/${reel.id}/comments`);
  const action = useAction();
  return (
    <div className="space-y-2 rounded-xl bg-stone-50 p-3">
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="text-stone-500">{t("Aucun commentaire")}</p>
      ) : (
        <ul className="divide-y divide-stone-200">
          {data.map((c) => (
            <li key={c.id} className={`flex flex-wrap items-start gap-2 py-2 ${c.hidden ? "opacity-50" : ""}`}>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-stone-500">
                  {c.author}
                  {c.phone ? ` · ${c.phone}` : ""} · {new Date(c.createdAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  {c.hidden && ` · ${t("Masqué")}`}
                </p>
                <p className="break-words">{c.text}</p>
              </div>
              <button
                onClick={() =>
                  action.run(async () => {
                    await adminFetch(`/reels/${reel.id}/comments/${c.id}`, { method: "PATCH", body: { hidden: !c.hidden } });
                    await reload();
                    onChanged();
                  })
                }
                className={buttonGhost}
              >
                {c.hidden ? t("Afficher") : t("Masquer")}
              </button>
              <button
                onClick={async () =>
                  (await askConfirm(t("Supprimer ce commentaire ?"), t("Supprimer"), { destructive: true })) &&
                  action.run(async () => {
                    await adminFetch(`/reels/${reel.id}/comments/${c.id}`, { method: "DELETE" });
                    await reload();
                    onChanged();
                  })
                }
                className={`${buttonGhost} text-red-700`}
              >
                {t("Supprimer")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ReelsAdminPage() {
  const { data, error, reload } = useAdmin<Reel[]>("/reels");
  const action = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [comments, setComments] = useState<string | null>(null);
  const t = useT();
  const nextPosition = data?.length ? Math.max(...data.map((r) => r.position)) + 1 : 1;

  const save = (id: string, body: Partial<Reel>) =>
    action.run(async () => {
      await adminFetch(`/reels/${id}`, { method: "PATCH", body });
      await reload();
      setEditing(null);
    });

  return (
    <div className="space-y-4">
      <PageHeader
        icon="reel"
        title="Nouveautés"
        count={data?.length}
        description="Courtes vidéos des produits, dans l'onglet « Nouveautés » de l'appli client. Le client les fait défiler, les aime, les commente et commande directement le plat ou le produit relié."
      />
      <ErrorNote message={action.error ?? error} />
      {!data ? (
        <Loading />
      ) : (
        <>
          <Card title="Nouvelle vidéo">
            <ReelForm
              nextPosition={nextPosition}
              onSubmit={(body) =>
                action.run(async () => {
                  await adminFetch("/reels", { method: "POST", body });
                  await reload();
                })
              }
            />
          </Card>
          <Card title="Vidéos">
            {data.length === 0 ? (
              <Empty>Aucune vidéo pour le moment</Empty>
            ) : (
              <ul className="divide-y divide-stone-100">
                {data.map((r) => {
                  const s = status(r, t);
                  return editing === r.id ? (
                    <li key={r.id} className="py-3">
                      <ReelForm reel={r} nextPosition={nextPosition} onSubmit={(b) => save(r.id, b)} onCancel={() => setEditing(null)} />
                    </li>
                  ) : (
                    <li key={r.id} className="space-y-2 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <video src={r.videoUrl} poster={r.posterUrl ?? undefined} muted playsInline preload="none" className={`aspect-[9/16] w-20 shrink-0 rounded-lg bg-black object-cover ${s.label === t("En ligne") ? "" : "opacity-50"}`} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="flex flex-wrap items-center gap-2 font-medium">
                            <span className="text-stone-400">#{r.position}</span> <span>{r.title}</span>
                            <span className={`rounded-full px-2 py-1 text-xs font-medium ${s.tone}`}>{s.label}</span>
                          </p>
                          <p className="truncate text-sm text-stone-500">
                            {r.order?.kind === "DISH" ? t("Plat") : r.order?.kind === "PRODUCT" ? t("Produit") : r.order ? t("Lien") : t("Sans « Commander »")}
                            {r.order?.seller ? ` · ${r.targetName} (${r.order.seller})` : r.order?.kind === "LINK" ? ` · ${r.order.href}` : ""}
                            {r.order?.price != null ? ` · ${fcfa(r.order.price)}` : ""}
                            {r.order && !r.order.available && <span className="text-red-700"> · {t("indisponible")}</span>}
                          </p>
                          <p className="text-sm text-stone-600">
                            ♥ {r.likeCount} · 💬 {r.commentCount}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <button onClick={() => setComments(comments === r.id ? null : r.id)} className={buttonGhost}>
                            {t("Commentaires")}
                          </button>
                          <button onClick={() => setEditing(r.id)} className={buttonGhost}>
                            {t("Modifier")}
                          </button>
                          <button onClick={() => save(r.id, { active: !r.active })} className={buttonGhost}>
                            {r.active ? t("Masquer") : t("Afficher")}
                          </button>
                          <button
                            onClick={async () =>
                              (await askConfirm(t("Supprimer la vidéo « {title} » ? Ses « j'aime » et commentaires seront effacés.", { title: r.title }), t("Supprimer"), { destructive: true })) &&
                              action.run(async () => {
                                await adminFetch(`/reels/${r.id}`, { method: "DELETE" });
                                await reload();
                              })
                            }
                            className={`${buttonGhost} text-red-700`}
                          >
                            {t("Supprimer")}
                          </button>
                        </div>
                      </div>
                      {comments === r.id && <Comments reel={r} onChanged={reload} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
