"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Icon } from "@/components/panel/icons";
import {
  adminFetch,
  formatTime,
  REQUEST_CHANNEL_LABEL,
  REQUEST_SOURCE_LABEL,
  REQUEST_STATUS_LABEL,
  useStaff,
  type AdminRestaurant,
  type RequestChannel,
  type RequestSource,
  type SupportRequest,
} from "@/lib/admin";
import { useT } from "@/lib/i18n/client";
import { ContactButtons } from "../ContactButtons";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, Tabs } from "../ui";
import { useAction, useAdmin } from "../useAdmin";

type Tab = "OPEN" | "ACTIVE" | "MINE" | "DONE";

const STATUS_STYLE = { OPEN: "bg-amber-100 text-amber-900", IN_PROGRESS: "bg-sky-100 text-sky-900", DONE: "bg-stone-100 text-stone-600" } as const;

export default function RequestsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Requests />
    </Suspense>
  );
}

function Requests() {
  const params = useSearchParams();
  const prefill = {
    source: (params.get("source") as RequestSource | null) ?? "CUSTOMER",
    phone: params.get("phone") ?? "",
    name: params.get("name") ?? "",
    orderId: params.get("orderId") ?? "",
    restaurantId: params.get("restaurantId") ?? "",
    subject: params.get("subject") ?? "",
  };
  const fromLink = Boolean(prefill.phone || prefill.orderId || prefill.restaurantId);
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [adding, setAdding] = useState(fromLink);
  const [q, setQ] = useState("");
  const staff = useStaff();
  const t = useT();
  const status = tab === "MINE" ? "ACTIVE" : tab;
  const list = useAdmin<SupportRequest[]>(`/requests?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const counts = useAdmin<SupportRequest[]>("/requests?status=ACTIVE");
  const me = staff?.id ? staff.name : "Direction";
  const rows = tab === "MINE" ? list.data?.filter((r) => r.assignedTo === me) : list.data;
  const active = counts.data ?? [];

  const reload = async () => {
    await Promise.all([list.reload(), counts.reload()]);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        icon="phone"
        title="Demandes"
        description="Appels et messages WhatsApp des clients, restaurants, boutiques et livreurs. File commune : prenez une demande, notez ce qui a été fait, puis closez-la."
        actions={
          !adding && (
            <button onClick={() => setAdding(true)} className={button}>
              <Icon name="plus" className="h-4 w-4" /> {t("Nouvelle demande")}
            </button>
          )
        }
      />
      {adding && (
        <NewRequest
          prefill={prefill}
          onDone={async () => {
            setAdding(false);
            await reload();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "ACTIVE", label: "En attente et en cours", count: active.length },
          { value: "OPEN", label: "À traiter", count: active.filter((r) => r.status === "OPEN").length },
          { value: "MINE", label: "Les miennes", count: active.filter((r) => r.assignedTo === me).length },
          { value: "DONE", label: "Closes" },
        ]}
      />
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Rechercher (objet, nom, téléphone, commande, restaurant)")} className={input} />
      <ErrorNote message={list.error} />
      {!rows ? (
        <Loading />
      ) : rows.length === 0 ? (
        <Empty>{t("Aucune demande ici.")}</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <RequestItem key={r.id} r={r} me={me} onChange={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NewRequest({
  prefill,
  onDone,
  onCancel,
}: {
  prefill: { source: RequestSource; phone: string; name: string; orderId: string; restaurantId: string; subject: string };
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const action = useAction();
  const [source, setSource] = useState<RequestSource>(prefill.source);
  const restaurants = useAdmin<AdminRestaurant[]>("/restaurants");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = (k: string) => String(f.get(k) ?? "").trim() || null;
    const ok = await action.run(() =>
      adminFetch("/requests", {
        method: "POST",
        body: {
          source,
          channel: f.get("channel"),
          direction: f.get("direction"),
          subject: f.get("subject"),
          details: value("details"),
          contactName: value("contactName"),
          contactPhone: value("contactPhone"),
          priority: f.get("urgent") ? "URGENT" : "NORMAL",
          orderId: prefill.orderId || null,
          restaurantId: source === "RESTAURANT" ? value("restaurantId") : prefill.restaurantId || null,
          status: f.get("status"),
        },
      }),
    );
    if (ok) await onDone();
  }

  return (
    <Card title="Nouvelle demande" icon="phone">
      <form onSubmit={submit} className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          {t("De la part de")}
          <select value={source} onChange={(e) => setSource(e.target.value as RequestSource)} className={input}>
            {(Object.keys(REQUEST_SOURCE_LABEL) as RequestSource[]).map((s) => (
              <option key={s} value={s}>
                {t(REQUEST_SOURCE_LABEL[s])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Canal")}
          <select name="channel" defaultValue="WHATSAPP_CALL" className={input}>
            {(Object.keys(REQUEST_CHANNEL_LABEL) as RequestChannel[]).map((c) => (
              <option key={c} value={c}>
                {t(REQUEST_CHANNEL_LABEL[c])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          {t("Sens")}
          <select name="direction" defaultValue={prefill.orderId ? "OUT" : "IN"} className={input}>
            <option value="IN">{t("Reçue (il nous a contactés)")}</option>
            <option value="OUT">{t("Passée (nous l'avons contacté)")}</option>
          </select>
        </label>
        {source === "RESTAURANT" ? (
          <label className="text-sm">
            {t("Restaurant ou boutique")}
            <select name="restaurantId" defaultValue={prefill.restaurantId} className={input}>
              <option value="">{t("Choisir")}</option>
              {restaurants.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="hidden sm:block" />
        )}
        <input name="contactName" defaultValue={prefill.name} placeholder={t("Nom du contact")} className={input} />
        <input name="contactPhone" defaultValue={prefill.phone} placeholder={t("Téléphone ou WhatsApp")} className={input} />
        <input name="subject" required minLength={3} maxLength={140} defaultValue={prefill.subject} placeholder={t("Objet (ex. commande en retard, réclamation)")} className={`${input} sm:col-span-2`} />
        <textarea name="details" rows={3} maxLength={2000} placeholder={t("Ce que la personne demande, ce qui a été répondu")} className={`${input} sm:col-span-2`} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="urgent" className="h-4 w-4 accent-red-600" /> {t("Urgent")}
        </label>
        <label className="text-sm">
          {t("Ensuite")}
          <select name="status" defaultValue="IN_PROGRESS" className={input}>
            <option value="IN_PROGRESS">{t("Je m'en occupe")}</option>
            <option value="OPEN">{t("Laisser dans la file commune")}</option>
            <option value="DONE">{t("Déjà réglée : clore")}</option>
          </select>
        </label>
        {prefill.orderId && <p className="text-sm text-stone-500 sm:col-span-2">{t("Liée à la commande ouverte.")}</p>}
        <div className="flex gap-2 sm:col-span-2">
          <button className={button}>{t("Enregistrer")}</button>
          <button type="button" onClick={onCancel} className={buttonGhost}>
            {t("Annuler")}
          </button>
        </div>
        <div className="sm:col-span-2">
          <ErrorNote message={action.error} />
        </div>
      </form>
    </Card>
  );
}

function RequestItem({ r, me, onChange }: { r: SupportRequest; me: string; onChange: () => Promise<void> }) {
  const t = useT();
  const action = useAction();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const patch = (body: Record<string, unknown>) =>
    action.run(async () => {
      await adminFetch(`/requests/${r.id}`, { method: "PATCH", body });
      await onChange();
    });
  const phone = r.contactPhone ?? r.restaurant?.phone ?? r.order?.customerPhone ?? null;

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button onClick={() => setOpen((o) => !o)} className="text-left">
          <p className="font-semibold">
            {r.priority === "URGENT" && <span className="mr-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{t("Urgent")}</span>}
            {r.subject}
          </p>
          <p className="text-sm text-stone-500">
            {t(REQUEST_SOURCE_LABEL[r.source])}
            {r.restaurant ? ` · ${r.restaurant.name}` : ""}
            {r.contactName ? ` · ${r.contactName}` : ""} · {t(REQUEST_CHANNEL_LABEL[r.channel])} · {r.direction === "OUT" ? t("passée") : t("reçue")} · {formatTime(r.createdAt)}
          </p>
          <p className="text-xs text-stone-500">
            {t("Saisie par {name}", { name: r.createdBy })}
            {r.assignedTo ? ` · ${t("suivie par {name}", { name: r.assignedTo })}` : ` · ${t("personne ne s'en occupe")}`}
            {r.notes.length > 0 ? ` · ${t("{n} notes", { n: r.notes.length })}` : ""}
          </p>
        </button>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>{t(REQUEST_STATUS_LABEL[r.status])}</span>
      </div>
      {r.order && (
        <Link href={`/admin/commandes/${r.order.id}`} className="mt-1 inline-block text-sm text-emerald-700 underline">
          {t("Commande {code}", { code: r.order.code })}
        </Link>
      )}
      <ContactButtons phone={phone} />
      <div className="mt-2 flex flex-wrap gap-2">
        {r.status !== "DONE" && r.assignedTo !== me && (
          <button onClick={() => patch({ take: true })} className={buttonGhost}>
            {t("Je m'en occupe")}
          </button>
        )}
        {r.status !== "DONE" && r.assignedTo === me && (
          <button onClick={() => patch({ take: false })} className={buttonGhost}>
            {t("Remettre dans la file")}
          </button>
        )}
        {r.status !== "DONE" ? (
          <button onClick={() => patch({ status: "DONE" })} className={buttonGhost}>
            <Icon name="check" className="h-4 w-4" /> {t("Clore")}
          </button>
        ) : (
          <button onClick={() => patch({ status: "OPEN" })} className={buttonGhost}>
            {t("Rouvrir")}
          </button>
        )}
        <button onClick={() => setOpen((o) => !o)} className={buttonGhost}>
          {open ? t("Masquer le suivi") : t("Suivi et notes")}
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-2 border-t border-stone-100 pt-3 text-sm">
          {r.details && <p className="whitespace-pre-line">{r.details}</p>}
          <ul className="space-y-1">
            {r.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-stone-50 px-3 py-2">
                <span className="text-xs text-stone-500">
                  {n.author} · {formatTime(n.createdAt)}
                </span>
                <p className="whitespace-pre-line">{n.body}</p>
              </li>
            ))}
          </ul>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await action.run(async () => {
                await adminFetch(`/requests/${r.id}/notes`, { method: "POST", body: { body: note } });
                await onChange();
              });
              if (ok) setNote("");
            }}
            className="flex gap-2"
          >
            <input value={note} onChange={(e) => setNote(e.target.value)} required placeholder={t("Ajouter une note (appel passé, réponse du restaurant…)")} className={input} />
            <button className={button}>{t("Ajouter")}</button>
          </form>
        </div>
      )}
      <ErrorNote message={action.error} />
    </li>
  );
}
