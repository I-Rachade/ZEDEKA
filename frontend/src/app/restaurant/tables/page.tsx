"use client";

import { useEffect, useState } from "react";
import { buttonGhost, ErrorNote, Loading, PageHeader } from "@/components/panel/ui";
import { Icon } from "@/components/panel/icons";
import TablesEditor, { type Table } from "@/components/panel/TablesEditor";
import { getRestaurantName, restaurantFetch } from "@/lib/restaurant";
import { useT } from "@/lib/i18n/client";
import { useRestaurant, useRestaurantAction } from "../useRestaurant";

// Tables numérotées et leurs QR codes. Le client scanne le code posé sur sa table, commande sur place, et la
// commande arrive ici avec le numéro de la table : le restaurant l'apporte, sans livreur.
export default function RestaurantTablesPage() {
  const { data, error, reload } = useRestaurant<Table[]>("/tables");
  const action = useRestaurantAction();
  const [name, setName] = useState("");
  const t = useT();
  useEffect(() => setName(getRestaurantName() ?? ""), []);

  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;

  return (
    <div className="space-y-4">
      <PageHeader
        icon="qr"
        title="Tables et QR codes"
        count={data.length}
        description="Posez sur chaque table son QR code. Le client le scanne, commande sur place, et la commande arrive ici avec le numéro de la table : apportez-la, sans livreur."
        actions={
          data.length > 0 && (
            <button onClick={() => window.print()} className={buttonGhost}>
              <Icon name="print" className="h-4 w-4" /> {t("Imprimer tous les QR codes")}
            </button>
          )
        }
      />
      <div className="print:hidden">
        <ErrorNote message={action.error} />
      </div>
      <TablesEditor tables={data} fetcher={restaurantFetch} run={action.run} reload={reload} restaurant={name} />
    </div>
  );
}
