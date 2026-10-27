import type { Metadata } from "next";
import Privacy from "@/components/legal/Privacy";
import InfoPage from "../InfoPage";

export const metadata: Metadata = { title: "Confidentialité – Zedeka" };

export default function PrivacyPage() {
  return (
    <InfoPage title="Confidentialité">
      <Privacy />
    </InfoPage>
  );
}
