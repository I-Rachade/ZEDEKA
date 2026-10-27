"use client";

import { AccountPage } from "@/components/panel/PartnerAccount";
import { ErrorNote, Loading } from "@/components/panel/ui";
import { rentalClient } from "@/lib/partnerClients";
import { rental, type Provider } from "@/lib/rental";

export default function RentalAccountPage() {
  const { data, error } = rental.useResource<Provider>("/me");
  if (error) return <ErrorNote message={error} />;
  if (!data) return <Loading />;
  return <AccountPage api={rentalClient} name={data.name} email={data.ownerEmail ?? null} phone={data.phone} what="nouvelle réservation" />;
}
