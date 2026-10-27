import { apiGet } from "@/lib/api";

export type Policies = { freeCancellationMinutes: number; cancellationFeePercent: number; whatsapp: string };

export const getPolicies = () => apiGet<Policies>("/api/policies").catch(() => null);
