"use client";

import { useState } from "react";
import DataTable from "@/components/panel/DataTable";
import { formatTime } from "@/lib/admin";
import { Card, ErrorNote, Loading, PageHeader, Tabs } from "../ui";
import { useAdmin } from "../useAdmin";
import { useT } from "@/lib/i18n/client";
import { APPLICATION_LABEL, ApplicationPill, BUSINESS_LABEL, type ApplicationStatus } from "./shared";

type Row = {
  id: string;
  reference: string;
  status: ApplicationStatus;
  businessName: string;
  businessType: string;
  ownerFirstName: string;
  ownerLastName: string;
  phone: string;
  plan: string;
  createdAt: string;
  zone: { name: string };
};

export default function ApplicationsPage() {
  const [tab, setTab] = useState<ApplicationStatus>("PENDING");
  const t = useT();
  const { data, error } = useAdmin<{ applications: Row[]; counts: Record<ApplicationStatus, number> }>(`/vendor-applications?status=${tab}`);

  return (
    <div>
      <PageHeader
        icon="bell"
        title="Candidatures"
        count={data?.counts.PENDING}
        description="Commerces inscrits via « Devenir partenaire ». La validation crée le restaurant et l'accès du gérant."
      />
      <Card>
        <Tabs
          tabs={(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => ({ value: s, label: APPLICATION_LABEL[s], count: data?.counts[s] }))}
          value={tab}
          onChange={setTab}
        />
        <ErrorNote message={error} />
        {!data ? (
          <Loading />
        ) : (
          <DataTable
            rows={data.applications}
            rowKey={(a) => a.id}
            rowHref={(a) => `/admin/candidatures/${a.id}`}
            empty="Aucune candidature ici."
            columns={[
              {
                header: "Commerce",
                mobile: "title",
                cell: (a) => (
                  <span>
                    <span className="font-semibold">{a.businessName}</span>
                    <span className="block text-xs text-stone-500">{a.reference}</span>
                  </span>
                ),
              },
              { header: "Statut", mobile: "badge", cell: (a) => <ApplicationPill status={a.status} /> },
              { header: "Type", cell: (a) => t(BUSINESS_LABEL[a.businessType] ?? a.businessType) },
              { header: "Gérant", cell: (a) => `${a.ownerFirstName} ${a.ownerLastName} · ${a.phone}` },
              { header: "Zone", cell: (a) => a.zone.name.split(" – ")[0] },
              { header: "Formule", cell: (a) => (a.plan === "SUBSCRIPTION" ? t("Abonnement") : t("Commission")) },
              { header: "Reçue le", cell: (a) => formatTime(a.createdAt) },
            ]}
          />
        )}
      </Card>
    </div>
  );
}
