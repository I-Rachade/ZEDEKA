"use client";

import { ForgotPassword } from "@/components/panel/PartnerAccount";
import { rental } from "@/lib/rental";

export default function RentalForgotPage() {
  return <ForgotPassword area="location" base="/location" saveSession={rental.saveSession} />;
}
