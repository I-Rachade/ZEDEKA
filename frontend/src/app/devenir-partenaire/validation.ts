import { tr } from "@/lib/i18n";

// Messages en français, traduits à l'affichage.
// Règles de validation du formulaire partenaire. Le backend applique les mêmes
// règles (backend/src/routes/vendorApplications.ts) ; garder les deux alignés.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_DOC_BYTES = 2 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];

export const BUSINESS_TYPES = [
  { value: "restaurant", label: "Restaurant / maquis" },
  { value: "fast_food", label: "Fast-food / snack" },
  { value: "patisserie", label: "Pâtisserie / boulangerie" },
  { value: "epicerie", label: "Épicerie / supérette" },
  { value: "pharmacie", label: "Pharmacie" },
  { value: "boutique", label: "Boutique" },
] as const;

export const MOMO_OPERATORS = [
  { value: "tmoney", label: "T-Money (Togocom)" },
  { value: "flooz", label: "Flooz (Moov Africa)" },
] as const;

// Numéros mobiles togolais : +228 puis 8 chiffres commençant par 7 ou 9.
export function normalizeTogoPhone(input: string): string | null {
  const digits = input.replace(/[\s.-]/g, "").replace(/^(\+|00)228/, "");
  return /^[79]\d{7}$/.test(digits) ? `+228${digits}` : null;
}

export const PASSWORD_RULES = [
  { id: "length", label: "8 caractères minimum", test: (p: string) => p.length >= 8 },
  { id: "lower", label: "Une minuscule", test: (p: string) => /[a-z]/.test(p) },
  { id: "upper", label: "Une majuscule", test: (p: string) => /[A-Z]/.test(p) },
  { id: "digit", label: "Un chiffre", test: (p: string) => /\d/.test(p) },
] as const;

export type FormValues = {
  businessName: string;
  businessType: string;
  zoneId: string;
  address: string;
  latitude: string;
  longitude: string;
  deliveryTimeMin: string;
  deliveryTimeMax: string;
  logo: File | null;
  cover: File | null;
  ownerFirstName: string;
  ownerLastName: string;
  phone: string;
  whatsapp: string;
  momoOperator: string;
  momoNumber: string;
  rccm: string;
  nif: string;
  legalDoc: File | null;
  email: string;
  password: string;
  passwordConfirm: string;
  plan: string;
  termsAccepted: boolean;
};

export type Errors = Partial<Record<keyof FormValues, string>>;

function checkFile(file: File | null, types: string[], max: number, required: boolean) {
  if (!file) return required ? "Fichier obligatoire" : undefined;
  if (!types.includes(file.type)) return "Format non accepté";
  if (file.size > max) return tr("Fichier trop lourd (max {n} Mo)", { n: Math.round(max / 1024 / 1024) });
  return undefined;
}

export function validateStep1(v: FormValues): Errors {
  const e: Errors = {};
  if (v.businessName.trim().length < 2) e.businessName = "Indiquez le nom du commerce";
  if (!v.businessType) e.businessType = "Choisissez un type de commerce";
  if (!v.zoneId) e.zoneId = "Choisissez une zone";
  if (v.address.trim().length < 5) e.address = "Indiquez une adresse ou un repère";

  const min = Number(v.deliveryTimeMin);
  const max = Number(v.deliveryTimeMax);
  if (!Number.isInteger(min) || min < 5 || min > 180) e.deliveryTimeMin = "Entre 5 et 180 min";
  if (!Number.isInteger(max) || max < 5 || max > 180) e.deliveryTimeMax = "Entre 5 et 180 min";
  else if (!e.deliveryTimeMin && max < min) e.deliveryTimeMax = "Doit être ≥ au minimum";

  e.logo = checkFile(v.logo, IMAGE_TYPES, MAX_IMAGE_BYTES, true);
  e.cover = checkFile(v.cover, IMAGE_TYPES, MAX_IMAGE_BYTES, true);
  e.legalDoc = checkFile(v.legalDoc, DOC_TYPES, MAX_DOC_BYTES, false);

  if (!v.ownerFirstName.trim()) e.ownerFirstName = "Prénom obligatoire";
  if (!v.ownerLastName.trim()) e.ownerLastName = "Nom obligatoire";
  if (!normalizeTogoPhone(v.phone)) e.phone = "Numéro togolais invalide (ex. 90 12 34 56)";
  if (v.whatsapp && !normalizeTogoPhone(v.whatsapp)) e.whatsapp = "Numéro togolais invalide";
  if (!v.momoOperator) e.momoOperator = "Choisissez un opérateur";
  if (!normalizeTogoPhone(v.momoNumber)) e.momoNumber = "Numéro Mobile Money invalide";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) e.email = "Adresse e-mail invalide";
  if (!PASSWORD_RULES.every((r) => r.test(v.password))) e.password = "Le mot de passe ne respecte pas les règles";
  if (v.password !== v.passwordConfirm) e.passwordConfirm = "Les mots de passe ne correspondent pas";

  return prune(e);
}

export function validateStep2(v: FormValues): Errors {
  const e: Errors = {};
  if (!v.plan) e.plan = "Choisissez une formule";
  if (!v.termsAccepted) e.termsAccepted = "Vous devez accepter les conditions";
  return e;
}

function prune(e: Errors): Errors {
  return Object.fromEntries(Object.entries(e).filter(([, msg]) => msg)) as Errors;
}
