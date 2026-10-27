import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import PartnerTerms from "@/components/legal/PartnerTerms";

export const metadata: Metadata = { title: "Conditions partenaires – Zedeka" };

export default function Page() {
  return (
    <LegalPage title="Conditions partenaires">
      <PartnerTerms />
    </LegalPage>
  );
}
