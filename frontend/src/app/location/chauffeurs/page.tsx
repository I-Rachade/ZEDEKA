"use client";

import { useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { Icon } from "@/components/panel/icons";
import { button, buttonGhost, Card, ErrorNote, input, Loading, PageHeader } from "@/components/panel/ui";
import { driverName, rental, type RentalDriver } from "@/lib/rental";

const ID_TYPES = ["CNI", "Passeport", "Permis de conduire", "Carte d'électeur"];
const text = (v: FormDataEntryValue | null) => String(v ?? "").trim();

function DriverForm({ driver, onDone }: { driver: RentalDriver | null; onDone: () => void }) {
  const action = rental.useAction();
  return (
    <Card title={driver ? `Modifier ${driverName(driver)}` : "Nouveau chauffeur"} icon="user">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const body = {
            firstName: text(f.get("firstName")),
            lastName: text(f.get("lastName")),
            phone: text(f.get("phone")),
            email: text(f.get("email")) || null,
            photoUrl: text(f.get("photoUrl")) || null,
            idType: text(f.get("idType")) || null,
            idNumber: text(f.get("idNumber")) || null,
            idImageUrl: text(f.get("idImageUrl")) || null,
          };
          const ok = await action.run(() =>
            driver ? rental.apiFetch(`/drivers/${driver.id}`, { method: "PATCH", body }) : rental.apiFetch("/drivers", { method: "POST", body }),
          );
          if (ok) onDone();
        }}
        className="space-y-3"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Informations</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <input name="firstName" required placeholder="Prénom" defaultValue={driver?.firstName} className={input} />
          <input name="lastName" required placeholder="Nom" defaultValue={driver?.lastName} className={input} />
          <input name="phone" required placeholder="Téléphone" defaultValue={driver?.phone} className={input} />
          <input name="email" type="email" placeholder="E-mail (facultatif)" defaultValue={driver?.email ?? ""} className={input} />
          <input name="photoUrl" type="url" placeholder="Lien de la photo (facultatif)" defaultValue={driver?.photoUrl ?? ""} className={`${input} sm:col-span-2`} />
        </div>
        <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Pièce d&apos;identité</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <select name="idType" defaultValue={driver?.idType ?? ""} className={input} aria-label="Type de pièce">
            <option value="">Type de pièce</option>
            {ID_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input name="idNumber" placeholder="Numéro" defaultValue={driver?.idNumber ?? ""} className={input} />
          <input name="idImageUrl" type="url" placeholder="Lien de la photo de la pièce" defaultValue={driver?.idImageUrl ?? ""} className={input} />
        </div>
        <ErrorNote message={action.error} />
        <div className="flex gap-2">
          <button className={button}>{driver ? "Enregistrer" : "Ajouter le chauffeur"}</button>
          <button type="button" onClick={onDone} className={buttonGhost}>
            Annuler
          </button>
        </div>
      </form>
    </Card>
  );
}

export default function DriversPage() {
  const { data, error, reload } = rental.useResource<RentalDriver[]>("/drivers");
  const action = rental.useAction();
  const [editing, setEditing] = useState<RentalDriver | "new" | null>(null);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="user"
        title="Chauffeurs"
        count={data.length}
        description="Les chauffeurs que vous pouvez attribuer à une course, avec leur pièce d'identité."
        actions={
          editing === null && (
            <button onClick={() => setEditing("new")} className={button}>
              <Icon name="plus" className="h-4 w-4" /> Ajouter un chauffeur
            </button>
          )
        }
      />
      {editing !== null && (
        <DriverForm
          key={editing === "new" ? "new" : editing.id}
          driver={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      <Card>
        <ErrorNote message={action.error} />
        <DataTable
          rows={data}
          rowKey={(d) => d.id}
          empty="Aucun chauffeur pour le moment."
          columns={[
            {
              header: "Chauffeur",
              mobile: "title",
              cell: (d) => (
                <span>
                  <span className="font-semibold">{driverName(d)}</span>
                  <span className="block text-xs text-stone-500">{d.phone}</span>
                </span>
              ),
            },
            {
              header: "Statut",
              mobile: "badge",
              cell: (d) => (
                <button
                  onClick={() =>
                    action.run(async () => {
                      await rental.apiFetch(`/drivers/${d.id}`, { method: "PATCH", body: { active: !d.active } });
                      await reload();
                    })
                  }
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${d.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-600"}`}
                >
                  {d.active ? "Actif" : "Inactif"}
                </button>
              ),
            },
            { header: "Pièce", cell: (d) => (d.idType ? `${d.idType} ${d.idNumber ?? ""}` : "–") },
            { header: "Courses", cell: (d) => d.trips ?? 0 },
            { header: "Terminées", cell: (d) => d.completed ?? 0 },
            { header: "Annulées", cell: (d) => d.cancelled ?? 0 },
            {
              header: "Actions",
              align: "right",
              cell: (d) => (
                <button onClick={() => setEditing(d)} className={buttonGhost} aria-label={`Modifier ${driverName(d)}`}>
                  <Icon name="edit" className="h-4 w-4" />
                </button>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
