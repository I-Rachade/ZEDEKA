import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import DriverTerms from "@/components/legal/DriverTerms";

export const metadata: Metadata = { title: "Conditions livreurs – Zedeka" };

export default function Page() {
  return (
    <LegalPage title="Conditions livreurs">
      <DriverTerms />
    </LegalPage>
  );
}
