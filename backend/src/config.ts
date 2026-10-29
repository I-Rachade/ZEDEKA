// Vérification des secrets du Worker. Avec un mot de passe admin d'exemple ou une clé de jetons trop courte,
// la connexion admin est refusée plutôt que d'ouvrir l'accès.

const EXAMPLE_VALUES = ["changer-moi", "une-longue-chaine-aleatoire"];

export function configProblems(config: { adminPassword: string; adminSecret: string }): string[] {
  const problems: string[] = [];
  const { adminPassword: password, adminSecret: secret } = config;
  if (password.length < 12 || EXAMPLE_VALUES.includes(password)) problems.push("ADMIN_PASSWORD : 12 caractères minimum, différent de l'exemple");
  if (secret.length < 32 || EXAMPLE_VALUES.includes(secret)) problems.push("ADMIN_SECRET : 32 caractères aléatoires minimum (ex. openssl rand -hex 32)");
  return problems;
}
