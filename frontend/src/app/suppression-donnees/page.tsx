import { getPolicies } from "@/app/app/policies";
import DataDeletion from "@/components/legal/DataDeletion";
import LegalPage, { legalMetadata } from "@/components/legal/LegalPage";

export const generateMetadata = legalMetadata("Supprimer mes données");

// Page publique (aussi indiquée aux stores comme adresse de suppression des données).
export default async function Page() {
  const p = await getPolicies();
  return (
    <LegalPage title="Supprimer mes données" frenchOnly={false}>
      <DataDeletion whatsapp={p?.whatsapp || null} />
    </LegalPage>
  );
}
