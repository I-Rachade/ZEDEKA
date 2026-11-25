"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/panel/icons";
import { fcfa } from "@/lib/api";
import { useSession } from "@/lib/customer";
import { useT } from "@/lib/i18n/client";
import { deleteComment, fetchComments, fetchReels, postComment, setLike, type Reel, type ReelComment } from "@/lib/reels";

// Nouveautés : courtes vidéos de produits en plein écran, qui défilent d'un geste vers le haut, comme sur un
// réseau social. La vidéo à l'écran joue en boucle (sans le son au départ, comme le veulent les navigateurs),
// les autres s'arrêtent. À droite : « j'aime » (ou double toucher sur la vidéo), commentaires et partage ;
// en bas : le produit, son prix et « Commander », qui ouvre directement la fiche du plat ou du produit.

const loginHref = (reelId?: string) => `/app/connexion?suite=${encodeURIComponent(`/app/nouveautes${reelId ? `?v=${reelId}` : ""}`)}`;
const count = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(".", ",")} k` : String(n));

export default function NouveautesPage() {
  const t = useT();
  const [reels, setReels] = useState<Reel[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [muted, setMuted] = useState(true);
  const [commentsOf, setCommentsOf] = useState<Reel | null>(null);
  const [loginAsk, setLoginAsk] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const feed = useRef<HTMLDivElement>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    fetchReels()
      .then((r) => {
        setReels(r.reels);
        setNext(r.next);
        // Lien partagé (?v=<id>) : on ouvre directement sur cette vidéo.
        const wanted = new URLSearchParams(window.location.search).get("v");
        const at = wanted ? r.reels.findIndex((x) => x.id === wanted) : -1;
        if (at > 0) requestAnimationFrame(() => feed.current?.children[at]?.scrollIntoView({ block: "start" }));
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // Vidéo à l'écran : celle qui en occupe plus de la moitié.
  useEffect(() => {
    const root = feed.current;
    if (!root || !reels?.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { root, threshold: 0.6 },
    );
    root.querySelectorAll("[data-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [reels]);

  // Page suivante quand il reste trois vidéos à voir.
  useEffect(() => {
    if (!reels || !next || loadingMore.current || active < reels.length - 3) return;
    loadingMore.current = true;
    fetchReels(next)
      .then((r) => {
        setReels((cur) => [...(cur ?? []), ...r.reels.filter((x) => !(cur ?? []).some((c) => c.id === x.id))]);
        setNext(r.next);
      })
      .catch(() => {})
      .finally(() => (loadingMore.current = false));
  }, [active, next, reels]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2000);
    return () => clearTimeout(timer);
  }, [toast]);

  const patch = useCallback((id: string, change: Partial<Reel>) => setReels((cur) => cur?.map((r) => (r.id === id ? { ...r, ...change } : r)) ?? cur), []);

  return (
    <div className="fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-0 mx-auto max-w-md overflow-hidden bg-black text-white">
      <header className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between bg-gradient-to-b from-black/55 to-transparent px-4 pb-6 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <h1 className="text-[22px] font-bold drop-shadow">{t("Nouveautés")}</h1>
        {!!reels?.length && (
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            aria-label={muted ? t("Activer le son") : t("Couper le son")}
            className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/35 backdrop-blur"
          >
            <Icon name={muted ? "mute" : "sound"} className="h-5 w-5" />
          </button>
        )}
      </header>

      {error ? (
        <Center title={t("Impossible de charger les nouveautés")} text={error} />
      ) : reels === null ? (
        <div className="grid h-full place-items-center">
          <span className="h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" aria-label={t("Chargement…")} />
        </div>
      ) : reels.length === 0 ? (
        <Center title={t("Pas encore de nouveautés")} text={t("Les vidéos de nos nouveaux produits arrivent bientôt. Revenez vite !")} />
      ) : (
        <div ref={feed} className="h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain [scrollbar-width:none]">
          {reels.map((r, i) => (
            <Slide
              key={r.id}
              reel={r}
              index={i}
              active={i === active}
              near={Math.abs(i - active) <= 1}
              muted={muted}
              onLike={async (liked) => {
                patch(r.id, { liked, likeCount: Math.max(0, r.likeCount + (liked ? 1 : -1)) });
                try {
                  const res = await setLike(r.id, liked);
                  patch(r.id, { liked: res.liked, likeCount: res.likeCount });
                } catch (e) {
                  patch(r.id, { liked: r.liked, likeCount: r.likeCount });
                  if ((e as { status?: number }).status === 401) setLoginAsk(t("Connectez-vous pour aimer cette vidéo."));
                  else setToast((e as Error).message);
                }
              }}
              onComments={() => setCommentsOf(r)}
              onShare={async () => {
                const url = `${window.location.origin}/app/nouveautes?v=${r.id}`;
                try {
                  if (navigator.share) await navigator.share({ title: r.title, url });
                  else {
                    await navigator.clipboard.writeText(url);
                    setToast(t("Lien copié"));
                  }
                } catch {
                  // Partage annulé.
                }
              }}
              needLogin={(why) => setLoginAsk(why)}
            />
          ))}
        </div>
      )}

      {toast && (
        <p role="status" className="anim-fade-up absolute inset-x-0 top-20 z-30 mx-auto w-max max-w-[80%] rounded-full bg-black/75 px-4 py-2 text-center text-[14px]">
          {toast}
        </p>
      )}
      {commentsOf && (
        <CommentsSheet
          reel={commentsOf}
          onClose={() => setCommentsOf(null)}
          onCount={(n) => patch(commentsOf.id, { commentCount: n })}
          needLogin={() => setLoginAsk(t("Connectez-vous pour commenter."))}
        />
      )}
      {loginAsk && <LoginSheet text={loginAsk} reelId={reels?.[active]?.id} onClose={() => setLoginAsk(null)} />}
    </div>
  );
}

function Center({ title, text }: { title: string; text: string }) {
  return (
    <div className="grid h-full place-items-center px-8 text-center">
      <div className="space-y-3">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-white/10">
          <Icon name="reel" className="h-8 w-8" />
        </span>
        <p className="text-[19px] font-bold">{title}</p>
        <p className="text-[15px] text-white/70">{text}</p>
      </div>
    </div>
  );
}

type SlideProps = {
  reel: Reel;
  index: number;
  active: boolean;
  near: boolean;
  muted: boolean;
  onLike: (liked: boolean) => void;
  onComments: () => void;
  onShare: () => void;
  needLogin: (why: string) => void;
};

function Slide({ reel: r, index, active, near, muted, onLike, onComments, onShare, needLogin }: SlideProps) {
  const t = useT();
  const router = useRouter();
  const session = useSession();
  const video = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [burst, setBurst] = useState(0);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (active) {
      setPaused(false);
      v.play().catch(() => setPaused(true));
    } else {
      v.pause();
      v.currentTime = 0;
    }
  }, [active]);

  const like = () => {
    if (!session) return needLogin(t("Connectez-vous pour aimer cette vidéo."));
    onLike(!r.liked);
  };

  // Un toucher : pause ou lecture. Deux touchers rapides : « j'aime » avec un cœur qui éclate.
  const tap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      setBurst((b) => b + 1);
      if (!session) needLogin(t("Connectez-vous pour aimer cette vidéo."));
      else if (!r.liked) onLike(true);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => {
      const v = video.current;
      if (!v) return;
      if (v.paused) {
        v.play().catch(() => {});
        setPaused(false);
      } else {
        v.pause();
        setPaused(true);
      }
    }, 300);
  };

  const order = r.order;
  const go = () => {
    if (!order?.available) return;
    if (order.href.startsWith("/")) router.push(order.href);
    else window.open(order.href, "_blank", "noopener");
  };

  return (
    <section data-index={index} aria-roledescription="slide" aria-label={r.title} className="relative h-full w-full snap-start snap-always overflow-hidden">
      <video
        ref={video}
        src={near ? r.videoUrl : undefined}
        poster={r.posterUrl ?? undefined}
        muted={muted}
        loop
        playsInline
        preload={near ? "auto" : "none"}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)}
        onClick={tap}
        className="h-full w-full bg-black object-cover"
      />
      {paused && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-black/35 pl-1 backdrop-blur">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      )}
      {burst > 0 && (
        <span key={burst} className="anim-heart pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-28 w-28 fill-red-500 drop-shadow-lg">
            <path d="M12 20s-7.5-4.6-9-9.3C2 7.5 4.2 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 2.8 0 5 2.5 4 5.7-1.5 4.7-9 9.3-9 9.3z" />
          </svg>
        </span>
      )}

      {/* Actions à droite, comme sur les réseaux sociaux. */}
      <div className="absolute bottom-36 right-2 z-10 flex flex-col items-center gap-5">
        <RailButton label={r.liked ? t("Je n'aime plus") : t("J'aime")} pressed={r.liked} onClick={like} value={count(r.likeCount)}>
          <svg viewBox="0 0 24 24" className={`h-8 w-8 transition ${r.liked ? "scale-110 fill-red-500 stroke-red-500" : "fill-none stroke-white"}`} strokeWidth={1.8} strokeLinejoin="round">
            <path d="M12 20s-7.5-4.6-9-9.3C2 7.5 4.2 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 2.8 0 5 2.5 4 5.7-1.5 4.7-9 9.3-9 9.3z" />
          </svg>
        </RailButton>
        <RailButton label={t("Commentaires")} onClick={onComments} value={count(r.commentCount)}>
          <Icon name="comment" className="h-8 w-8" />
        </RailButton>
        <RailButton label={t("Partager")} onClick={onShare} value={t("Partager")}>
          <Icon name="share" className="h-7 w-7" />
        </RailButton>
      </div>

      {/* Produit, prix et « Commander ». */}
      <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-4 pt-16">
        {order?.seller && <p className="text-[13px] font-semibold uppercase tracking-wide text-amber-300">{order.seller}</p>}
        <p className="pr-16 text-[20px] font-bold leading-tight drop-shadow">{r.title}</p>
        {r.caption && <p className="line-clamp-2 pr-16 text-[14px] text-white/85">{r.caption}</p>}
        {order && (
          <button
            type="button"
            onClick={go}
            disabled={!order.available}
            className="mt-1 flex w-full items-center justify-between gap-3 rounded-[14px] bg-amber-400 px-4 py-3.5 text-[16px] font-bold text-stone-900 shadow-lg transition active:scale-[0.98] disabled:bg-white/25 disabled:text-white/80"
          >
            <span className="flex items-center gap-2">
              <Icon name="bag" className="h-5 w-5" />
              {order.available ? t("Commander") : t("Indisponible pour le moment")}
            </span>
            {order.price !== null && <span>{fcfa(order.price)}</span>}
          </button>
        )}
      </div>

      <span className="absolute inset-x-0 bottom-0 z-20 h-[3px] bg-white/20" aria-hidden="true">
        <span className="block h-full bg-white" style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
    </section>
  );
}

function RailButton({ label, pressed, value, onClick, children }: { label: string; pressed?: boolean; value: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} aria-pressed={pressed} className="flex flex-col items-center gap-1 text-[12px] font-semibold drop-shadow active:scale-90">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-black/25 backdrop-blur-sm">{children}</span>
      <span aria-hidden="true">{value}</span>
    </button>
  );
}

function LoginSheet({ text, reelId, onClose }: { text: string; reelId?: string; onClose: () => void }) {
  const t = useT();
  // Au-dessus de la barre d'onglets : rendue à la racine de la page.
  return createPortal(
    <>
      <button type="button" aria-label={t("Fermer")} onClick={onClose} className="fixed inset-0 z-[60] bg-black/50" />
      <div role="dialog" aria-label={text} className="anim-slide-up fixed inset-x-0 bottom-0 z-[61] mx-auto max-w-md space-y-3 rounded-t-[20px] bg-surface p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-ink">
        <span className="mx-auto block h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />
        <p className="text-[18px] font-bold">{text}</p>
        <p className="text-[14px] text-stone-500">{t("Avec votre compte Zedeka, aimez les produits, commentez et commandez en un geste.")}</p>
        <Link href={loginHref(reelId)} className="block rounded-xl bg-emerald-600 py-3.5 text-center text-[16px] font-semibold text-white">
          {t("Se connecter")}
        </Link>
        <button type="button" onClick={onClose} className="block w-full py-2 text-[15px] font-medium text-stone-500">
          {t("Plus tard")}
        </button>
      </div>
    </>,
    document.body,
  );
}

function CommentsSheet({ reel, onClose, onCount, needLogin }: { reel: Reel; onClose: () => void; onCount: (n: number) => void; needLogin: () => void }) {
  const t = useT();
  const session = useSession();
  const [list, setList] = useState<ReelComment[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchComments(reel.id)
      .then(setList)
      .catch((e: Error) => setError(e.message));
  }, [reel.id]);

  const when = (iso: string) => {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    if (min < 1) return t("à l'instant");
    if (min < 60) return t("il y a {n} min", { n: min });
    if (min < 1440) return t("il y a {n} h", { n: Math.round(min / 60) });
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  };

  return createPortal(
    <>
      <button type="button" aria-label={t("Fermer")} onClick={onClose} className="fixed inset-0 z-[60] bg-black/40" />
      <div role="dialog" aria-label={t("Commentaires")} className="anim-slide-up fixed inset-x-0 bottom-0 z-[61] mx-auto flex max-h-[75dvh] max-w-md flex-col rounded-t-[20px] bg-surface text-ink">
        <div className="relative border-b border-stone-100 px-4 pb-3 pt-2 text-center">
          <span className="mx-auto mb-2 block h-1 w-10 rounded-full bg-stone-200" aria-hidden="true" />
          <p className="text-[15px] font-bold">{(list?.length ?? reel.commentCount) === 1 ? t("1 commentaire") : t("{n} commentaires", { n: list?.length ?? reel.commentCount })}</p>
          <button type="button" onClick={onClose} aria-label={t("Fermer")} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-stone-500">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <ul className="min-h-[140px] flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {error && <li className="text-[14px] text-red-700">{error}</li>}
          {list === null && !error && <li className="skeleton h-10 rounded-lg" />}
          {list?.length === 0 && <li className="py-6 text-center text-[14px] text-stone-500">{t("Soyez le premier à commenter.")}</li>}
          {list?.map((c) => (
            <li key={c.id} className="flex gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-[14px] font-bold text-emerald-800" aria-hidden="true">
                {c.author.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-stone-500">
                  <strong className="font-semibold text-stone-800">{c.author}</strong> · {when(c.createdAt)}
                </p>
                <p className="whitespace-pre-line break-words text-[15px]">{c.text}</p>
                {c.mine && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await deleteComment(reel.id, c.id);
                        setList((cur) => cur?.filter((x) => x.id !== c.id) ?? cur);
                        onCount(r.commentCount);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                    className="mt-1 text-[13px] font-medium text-stone-500"
                  >
                    {t("Supprimer")}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {session ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim() || busy) return;
              setBusy(true);
              setError(null);
              try {
                const r = await postComment(reel.id, text.trim());
                setList((cur) => [r.comment, ...(cur ?? [])]);
                onCount(r.commentCount);
                setText("");
              } catch (err) {
                if ((err as { status?: number }).status === 401) needLogin();
                else setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="flex items-center gap-2 border-t border-stone-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={300}
              placeholder={t("Ajouter un commentaire…")}
              aria-label={t("Votre commentaire")}
              className="min-w-0 flex-1 rounded-full bg-stone-100 px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <button type="submit" disabled={!text.trim() || busy} className="rounded-full bg-emerald-600 px-4 py-3 text-[15px] font-semibold text-white disabled:bg-stone-300">
              {t("Envoyer")}
            </button>
          </form>
        ) : (
          <div className="border-t border-stone-100 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Link href={loginHref(reel.id)} className="block rounded-full bg-emerald-600 py-3 text-center text-[15px] font-semibold text-white">
              {t("Se connecter pour commenter")}
            </Link>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
