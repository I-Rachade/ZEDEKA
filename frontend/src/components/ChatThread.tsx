"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/panel/icons";
import type { ChatMessage, ChatThreadData } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { useLiveRefresh } from "@/lib/live";

// Messagerie écrite entre le client et le livreur, commune au suivi du client et à la course du livreur.
// - ChatLauncher : bouton « Écrire à … » avec le nombre de messages non lus (relu sans les marquer comme lus).
// - ChatSheet : conversation plein écran, réponses rapides, relue toutes les 4 s et à chaque notification.
// Livraison terminée : la conversation reste lisible (archive), sans champ de saisie.

type Load = (peek: boolean) => Promise<ChatThreadData | null>;
type Send = (body: string) => Promise<ChatMessage>;

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function ChatSheet({ title, subtitle, load, send, onClose, note }: { title: string; subtitle?: string; load: Load; send: Send; onClose: () => void; note?: string | null }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<ChatThreadData | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const next = await load(false).catch(() => null);
    if (next) setData(next);
  }, [load]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useLiveRefresh(refresh, { every: 4000 });

  // Toujours en bas, sur le dernier message.
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [count]);

  // Échap ferme ; le défilement de la page derrière est bloqué.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  // fromField : texte tapé, vidé après l'envoi (une réponse rapide ne touche pas à ce qui est en cours de saisie).
  async function submit(body: string, fromField = false) {
    const clean = body.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await send(clean);
      setData((d) => (d ? { ...d, messages: [...d.messages, sent] } : d));
      if (fromField) {
        setText("");
        field.current?.focus();
      }
    } catch (e) {
      setError((e as Error).message);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  const hm = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lome" });
  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Lome" });

  // Rendue dans <body> : au-dessus de la barre d'onglets, quel que soit le conteneur de la page.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[2000] flex flex-col bg-stone-100">
      <header className="glass hairline-b flex items-center gap-3 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label={t("Fermer")} className="grid h-11 w-11 place-items-center text-emerald-600 active:opacity-50">
          <Icon name="back" className="h-6 w-6" />
        </button>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600 text-[17px] font-bold text-white" aria-hidden="true">
          {title.trim()[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-semibold">{title}</span>
          {subtitle && <span className="block truncate text-[12px] text-stone-500">{subtitle}</span>}
        </span>
      </header>

      <div ref={list} className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-live="polite">
        {!data ? (
          <p className="pt-10 text-center text-sm text-stone-400">{t("Chargement…")}</p>
        ) : data.messages.length === 0 ? (
          <div className="flex flex-col items-center gap-2 pt-16 text-center text-stone-400">
            <Icon name="chat" className="h-14 w-14" />
            <p className="font-semibold text-stone-500">{t("Aucun message")}</p>
            <p className="max-w-[16rem] text-sm">{data.open ? t("Écrivez ici : la conversation est gardée avec la commande.") : t("Aucun message n'a été échangé pour cette livraison.")}</p>
          </div>
        ) : (
          data.messages.map((m, i) => {
            const prev = data.messages[i - 1];
            const newDay = !prev || !sameDay(new Date(prev.at), new Date(m.at));
            return (
              <div key={m.id}>
                {newDay && <p className="py-2 text-center text-[11px] font-medium uppercase tracking-wide text-stone-400">{day(m.at)}</p>}
                <div className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[15px] shadow-sm ${m.mine ? "rounded-br-md bg-emerald-600 text-white" : "rounded-bl-md bg-surface text-stone-900"}`}>
                    {m.body}
                    <span className={`mt-0.5 block text-right text-[10.5px] tabular-nums ${m.mine ? "text-emerald-100" : "text-stone-400"}`}>
                      {hm(m.at)}
                      {m.mine && ` · ${m.read ? t("Lu") : t("Envoyé")}`}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {data && !data.open ? (
        <p className="hairline-t bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 text-center text-sm text-stone-500">
          <Icon name="lock" className="mr-1 inline h-4 w-4 align-[-3px]" />
          {data.messages.length ? t("Conversation archivée : la livraison est terminée.") : t("La conversation s'ouvre dès qu'un livreur a accepté la course.")}
        </p>
      ) : (
        <div className="hairline-t bg-surface pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {note && <p className="px-4 pt-2 text-[12px] text-stone-500">{note}</p>}
          {data && data.quickReplies.length > 0 && (
            <div data-noswipe className="flex gap-2 overflow-x-auto px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {data.quickReplies.map((q) => (
                <button key={q} disabled={busy} onClick={() => submit(t(q))} className="shrink-0 rounded-full bg-emerald-50 px-3 py-1.5 text-[13px] font-medium text-emerald-800 ring-1 ring-emerald-600/15 active:scale-95 disabled:opacity-50">
                  {t(q)}
                </button>
              ))}
            </div>
          )}
          {error && <p className="mx-3 mt-2 rounded-xl bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <form
            className="flex items-end gap-2 px-3 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              submit(text, true);
            }}
          >
            <textarea
              ref={field}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) {
                  e.preventDefault();
                  submit(text, true);
                }
              }}
              rows={1}
              maxLength={500}
              placeholder={t("Votre message")}
              aria-label={t("Votre message")}
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-[22px] bg-stone-100 px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-emerald-600/30"
            />
            <button type="submit" disabled={busy || !text.trim() || !data} aria-label={t("Envoyer")} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition active:scale-95 disabled:opacity-40">
              <Icon name="send" className="h-5 w-5" />
            </button>
          </form>
        </div>
      )}
    </div>
  , document.body);
}

// Bouton qui ouvre la conversation, avec le nombre de messages non lus. Rien tant qu'il n'y a ni conversation
// ouverte ni message (commande sans livreur, sur place…). autoOpen : lien d'une notification (?chat=1).
export function ChatLauncher({
  label,
  title,
  subtitle,
  load,
  send,
  note,
  autoOpen = false,
  className,
  every = 8000,
}: {
  label: string;
  title: string;
  subtitle?: string;
  load: Load;
  send: Send;
  note?: string | null;
  autoOpen?: boolean;
  className?: string;
  every?: number;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<{ open: boolean; count: number; unread: number } | null>(null);
  const [showing, setShowing] = useState(false);

  const peek = useCallback(async () => {
    const d = await load(true).catch(() => null);
    setState(d ? { open: d.open, count: d.messages.length, unread: d.unread } : null);
  }, [load]);
  useEffect(() => {
    peek();
  }, [peek]);
  useLiveRefresh(peek, { every, enabled: !showing });

  const opened = useRef(false);
  useEffect(() => {
    if (autoOpen && state && (state.open || state.count) && !opened.current) {
      opened.current = true;
      setShowing(true);
    }
  }, [autoOpen, state]);

  const close = useCallback(() => {
    setShowing(false);
    peek();
  }, [peek]);

  if (!state || (!state.open && state.count === 0)) return null;
  return (
    <>
      <button
        onClick={() => setShowing(true)}
        className={className ?? "card-gloss flex w-full items-center gap-3 rounded-[12px] bg-surface px-5 py-4 text-left transition active:scale-[0.99]"}
      >
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-600/10 text-emerald-700">
          <Icon name="chat" className="h-5 w-5" />
          {state.unread > 0 && (
            <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white" aria-hidden="true">
              {state.unread}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          <span className="block text-[13px] text-stone-500">
            {state.unread > 0 ? t("{n} message(s) non lu(s)", { n: state.unread }) : state.open ? t("Message écrit, gardé avec la commande") : t("Conversation archivée")}
          </span>
        </span>
        <Icon name="chevron" className="h-4 w-4 text-stone-300" />
      </button>
      {showing && <ChatSheet title={title} subtitle={subtitle} load={load} send={send} onClose={close} note={note} />}
    </>
  );
}
