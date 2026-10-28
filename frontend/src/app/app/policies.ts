import { serverGet } from "@/lib/serverApi";

export type Policies = { freeCancellationMinutes: number; cancellationFeePercent: number; whatsapp: string };

export const getPolicies = () => serverGet<Policies>("/api/policies").catch(() => null);
