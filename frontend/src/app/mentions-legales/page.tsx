import type { Metadata } from "next";
import LegalPage from "@/components/legal/LegalPage";
import LegalNotice from "@/components/legal/LegalNotice";

export const metadata: Metadata = { title: "Mentions légales – Zedeka" };

export default function Page() {
  return (
    <LegalPage title="Mentions légales">
      <LegalNotice />
    </LegalPage>
  );
}
