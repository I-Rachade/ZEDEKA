"use client";

import { ForgotPassword } from "@/components/panel/PartnerAccount";
import { saveRestaurantSession } from "@/lib/restaurant";

export default function RestaurantForgotPage() {
  return <ForgotPassword area="restaurant" base="/restaurant" saveSession={saveRestaurantSession} />;
}
