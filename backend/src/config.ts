// Vérifications de la configuration au démarrage. En production, une configuration dangereuse empêche le
// démarrage plutôt que d'ouvrir l'accès : mot de passe admin par défaut, clé des jetons trop courte, codes de test.

type Env = Record<string, string | undefined>;

const EXAMPLE_VALUES = ["changer-moi", "une-longue-chaine-aleatoire"];

// Codes affichés à l'écran : seulement si OTP_DEV_CODES=true, jamais en production.
export function otpDevCodes(env: Env): boolean {
  return env.OTP_DEV_CODES === "true" && env.NODE_ENV !== "production";
}

export function configProblems(env: Env): string[] {
  const problems: string[] = [];
  const password = env.ADMIN_PASSWORD ?? "";
  const secret = env.ADMIN_SECRET ?? "";
  if (password.length < 12 || EXAMPLE_VALUES.includes(password)) problems.push("ADMIN_PASSWORD : 12 caractères minimum, différent de l'exemple");
  if (secret.length < 32 || EXAMPLE_VALUES.includes(secret)) problems.push("ADMIN_SECRET : 32 caractères aléatoires minimum (ex. openssl rand -hex 32)");
  if (env.OTP_DEV_CODES === "true") problems.push("OTP_DEV_CODES=true : les codes de connexion seraient affichés à n'importe qui");
  return problems;
}
