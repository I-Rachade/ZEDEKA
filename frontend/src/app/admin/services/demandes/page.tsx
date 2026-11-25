"use client";

import { useState } from "react";
import { adminFetch } from "@/lib/admin";
import { fcfa } from "@/lib/api";
import { useT } from "@/lib/i18n/client";
import { MODULE_EMOJI, REQUEST_MODULES, slotLabel, STATUS_COLOR, STATUS_TEXT, type RequestModule, type ServiceRequest } from "@/lib/serviceRequests";
import { button, buttonGhost, Card, Empty, ErrorNote, input, Loading, PageHeader, Tabs } from "../../ui";
import { useAction, useAdmin } from "../../useAdmin";

// Demandes de service (courses, gaz et eau, lessive, ménage, dépannage) : suivre, attribuer à un prestataire, annuler.
// En bas, les livreurs et prestataires et les services que chacun fait (ils reçoivent les demandes de ces services).

type Provider = { id: string; name: string; phone: string; active: boolean; codes: RequestModule[]; busy: number };
type Reply = { requests: ServiceRequest[]; counts: Record<string, number>; providers: Provider[] };
type Filter = "open" | "done" | "cancelled" | "all";

const NAME: Record<RequestModule, string> = { ERRAND: "Courses pour moi", GAS: "Gaz et eau", LAUNDRY: "Lessive", CLEANING: "Ménage", REPAIR: "Dépannage" };

function RequestRow({ r, providers, onDone }: { r: ServiceRequest; providers: Provider[]; onDone: () => void }) {
  const t = useT();
  const action = useAction();
  const able = providers.filter((p) => p.codes.includes(r.module) && p.active);
  const [pick, setPick] = useState(r.provider?.id ?? "");
  const open = ["PENDING", "ACCEPTED", "ON_THE_WAY", "IN_PROGRESS"].includes(r.status);
  const run = (path: string, body: unknown) => action.run(() => adminFetch(`/service-requests/${r.id}/${path}`, { method: "POST", body })).then((ok) => ok && onDone());

  return (
    <li className="space-y-2 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-stone-100 text-[22px]" aria-hidden="true">
          {MODULE_EMOJI[r.module]}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {r.summary} <span className="text-[12px] font-normal text-stone-500">· {r.code}</span>
          </p>
          <p className="text-sm text-stone-600">
            {r.customer?.name ?? t("Client")} · {r.customer?.phone} · 📍 {r.address}
          </p>
          <p className="text-sm text-stone-500">
            {r.scheduledFor ? slotLabel(r.scheduledFor, "fr-FR") : t("Dès que possible")} · {t("Estimation")} {fcfa(r.estimate)}
            {r.finalPrice !== null && ` · ${t("Total")} ${fcfa(r.finalPrice)}`}
            {r.rating !== null && ` · ★ ${r.rating}`}
          </p>
          {typeof r.details.items === "string" && <p className="mt-1 whitespace-pre-line text-sm text-stone-700">{r.details.items}</p>}
          {r.note && <p className="text-sm italic text-stone-600">« {r.note} »</p>}
          {r.cancelReason && <p className="text-sm text-red-700">{r.cancelReason}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${STATUS_COLOR[r.status]}`}>{t(STATUS_TEXT[r.status])}</span>
      </div>
      {r.provider && (
        <p className="pl-14 text-sm">
          {t("Prestataire")} : <strong>{r.provider.name}</strong> · {r.provider.phone}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-2 pl-14">
          {r.status !== "IN_PROGRESS" && (
            <>
              <select aria-label={t("Prestataire pour {code}", { code: r.code })} value={pick} onChange={(e) => setPick(e.target.value)} className={`${input} w-56`}>
                <option value="">{able.length ? t("Choisir un prestataire") : t("Aucun prestataire pour ce service")}</option>
                {able.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.busy ? ` (${p.busy} en cours)` : ""}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!pick || pick === r.provider?.id} onClick={() => run("assign", { providerId: pick })} className={button}>
                {r.provider ? t("Réattribuer") : t("Attribuer")}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const reason = window.prompt(t("Raison de l'annulation (le client la verra)"));
              if (reason && reason.trim().length >= 3) run("cancel", { reason: reason.trim() });
            }}
            className={`${buttonGhost} text-red-700`}
          >
            {t("Annuler")}
          </button>
        </div>
      )}
      <ErrorNote message={action.error} />
    </li>
  );
}

function ProviderRow({ p, onSaved }: { p: Provider; onSaved: () => void }) {
  const t = useT();
  const action = useAction();
  const toggle = (code: RequestModule) => {
    const codes = p.codes.includes(code) ? p.codes.filter((c) => c !== code) : [...p.codes, code];
    action.run(() => adminFetch(`/service-providers/${p.id}`, { method: "PATCH", body: { codes } })).then((ok) => ok && onSaved());
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {p.name} {!p.active && <span className="text-[12px] font-normal text-stone-500">({t("inactif")})</span>}
        </p>
        <p className="text-sm text-stone-500">{p.phone}</p>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t("Services de {name}", { name: p.name })}>
        {REQUEST_MODULES.map((c) => {
          const on = p.codes.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              className={`rounded-[8px] px-2 py-1 text-[13px] font-semibold ${on ? "bg-emerald-600 text-white" : "bg-stone-100 text-stone-500"}`}
            >
              {MODULE_EMOJI[c]} {t(NAME[c])}
            </button>
          );
        })}
      </div>
      <ErrorNote message={action.error} />
    </li>
  );
}

export default function ServiceRequestsPage() {
  const t = useT();
  const [filter, setFilter] = useState<Filter>("open");
  const [module, setModule] = useState<RequestModule | "">("");
  const [search, setSearch] = useState("");
  const { data, error, reload } = useAdmin<Reply>(`/service-requests?status=${filter}${module ? `&module=${module}` : ""}`);
  const all = useAdmin<Provider[]>("/service-providers");
  const reloadAll = () => {
    reload();
    all.reload();
  };
  const openCount = ["PENDING", "ACCEPTED", "ON_THE_WAY", "IN_PROGRESS"].reduce((n, s) => n + (data?.counts[s] ?? 0), 0);
  const people = (all.data ?? []).filter((p) => !search || `${p.name} ${p.phone}`.toLowerCase().includes(search.toLowerCase()));
  const shown = search ? people : people.filter((p) => p.codes.length).concat(people.filter((p) => !p.codes.length).slice(0, 8));

  return (
    <div className="max-w-5xl">
      <PageHeader icon="grid" title="Demandes de service" count={openCount} description="Courses, gaz et eau, lessive, ménage et dépannage. Le premier prestataire disponible accepte la demande ; vous pouvez aussi l'attribuer." />
      <ErrorNote message={error} />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: "open", label: t("En cours"), count: openCount },
            { value: "done", label: t("Terminées"), count: data?.counts.DONE },
            { value: "cancelled", label: t("Annulées"), count: data?.counts.CANCELLED },
            { value: "all", label: t("Toutes") },
          ]}
        />
        <select aria-label={t("Service")} value={module} onChange={(e) => setModule(e.target.value as RequestModule | "")} className={`${input} w-44`}>
          <option value="">{t("Tous les services")}</option>
          {REQUEST_MODULES.map((c) => (
            <option key={c} value={c}>
              {MODULE_EMOJI[c]} {t(NAME[c])}
            </option>
          ))}
        </select>
      </div>
      <Card title="Demandes" icon="orders">
        {!data ? (
          <Loading />
        ) : data.requests.length === 0 ? (
          <Empty>{t("Aucune demande ici")}</Empty>
        ) : (
          <ul className="divide-y divide-stone-100">
            {data.requests.map((r) => (
              <RequestRow key={`${r.id}-${r.status}-${r.provider?.id ?? ""}`} r={r} providers={all.data ?? data.providers} onDone={reloadAll} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="Prestataires" icon="team">
        <p className="mb-2 text-sm text-stone-600">{t("Touchez un service pour l'ajouter ou le retirer. Chaque livreur reçoit les demandes des services de son profil.")}</p>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Rechercher un livreur (nom, numéro)")} aria-label={t("Rechercher un livreur")} className={`${input} mb-2 max-w-sm`} />
        {!all.data ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-stone-100">
            {shown.map((p) => (
              <ProviderRow key={p.id} p={p} onSaved={reloadAll} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
