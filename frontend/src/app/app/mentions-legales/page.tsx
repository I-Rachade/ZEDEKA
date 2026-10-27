import type { Metadata } from "next";
import LegalNotice from "@/components/legal/LegalNotice";
import InfoPage from "../InfoPage";

export const metadata: Metadata = { title: "Mentions légales – Zedeka" };

export default function LegalNoticePage() {
  return (
    <InfoPage title="Mentions légales">
      <LegalNotice />
    </InfoPage>
  );
}
