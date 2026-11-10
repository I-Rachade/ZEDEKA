import bcrypt from "bcryptjs";
import { z } from "zod";

// Code PIN des clients et des livreurs : 4 chiffres, haché avec bcrypt, 5 essais faux puis 15 minutes de blocage.
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;
// Après un code SMS ou e-mail vérifié, temps laissé pour choisir le nouveau PIN.
export const PIN_RESET_WINDOW_MS = 15 * 60 * 1000;

// Trop faciles à deviner : 4 chiffres identiques, suites (1234, 4321), 1212, 1122.
export function isWeakPin(pin: string): boolean {
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((v, i) => v - d[i]);
  if (steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  if (pin[0] === pin[2] && pin[1] === pin[3]) return true;
  if (pin[0] === pin[1] && pin[2] === pin[3]) return true;
  return false;
}

export const hashPin = (pin: string) => bcrypt.hash(pin, 10);
export const checkPin = (pin: string, hash: string) => bcrypt.compare(pin, hash);

// PIN choisi (inscription, changement) : 4 chiffres, pas trop facile.
export const newPinInput = z
  .string()
  .regex(/^\d{4}$/, "Le code PIN a 4 chiffres")
  .refine((pin) => !isWeakPin(pin), "Code PIN trop facile à deviner. Évitez 1234, 0000 ou 1212.");

// Champs du PIN jamais renvoyés par l'API (fiches livreurs de l'admin).
export function withoutPin<T extends { pinHash?: unknown; pinAttempts?: unknown; pinLockedUntil?: unknown; pinResetUntil?: unknown }>(row: T) {
  const { pinHash, pinAttempts: _a, pinLockedUntil: _l, pinResetUntil: _r, ...rest } = row;
  return { ...rest, hasPin: !!pinHash };
}

type PinCounter = { pinAttempts: number; pinLockedUntil: Date | null };

// Réserve un essai AVANT de comparer le PIN. Le compteur est augmenté par la base elle-même (increment) :
// des essais envoyés en même temps comptent chacun, au plus PIN_MAX_ATTEMPTS comparaisons par période de blocage.
// `clearExpired` remet le compteur à zéro quand un ancien blocage est passé (une seule requête y parvient),
// `bump` augmente le compteur et renvoie la ligne à jour, `lock` pose le blocage.
export async function reservePinAttempt(
  current: PinCounter,
  ops: { clearExpired: (until: Date) => Promise<unknown>; bump: () => Promise<PinCounter>; lock: () => Promise<unknown> },
): Promise<{ ok: true; attempts: number } | { ok: false; minutes: number }> {
  const now = Date.now();
  const minutesLeft = (until: Date) => Math.max(1, Math.ceil((until.getTime() - now) / 60_000));
  if (current.pinLockedUntil && current.pinLockedUntil.getTime() > now) return { ok: false, minutes: minutesLeft(current.pinLockedUntil) };
  if (current.pinLockedUntil) await ops.clearExpired(current.pinLockedUntil);
  const row = await ops.bump();
  if (row.pinLockedUntil && row.pinLockedUntil.getTime() > now) return { ok: false, minutes: minutesLeft(row.pinLockedUntil) };
  if (row.pinAttempts > PIN_MAX_ATTEMPTS) {
    await ops.lock();
    return { ok: false, minutes: Math.ceil(PIN_LOCK_MS / 60_000) };
  }
  return { ok: true, attempts: row.pinAttempts };
}
