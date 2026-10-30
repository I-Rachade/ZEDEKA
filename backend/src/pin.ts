import bcrypt from "bcryptjs";

// Code PIN des clients : 4 chiffres, haché avec bcrypt, 5 essais faux puis 15 minutes de blocage.
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
