// Ports et secrets des tests de bout en bout, partagés par la configuration Playwright et le lanceur de l'API.
// Ports à part (8788 et 3100) pour ne pas gêner `npm run dev` dans backend/ et frontend/.
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8788);
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3100);
// Secrets de test seulement : assez longs pour que l'API accepte la connexion admin (src/config.ts).
export const ADMIN_PASSWORD = "e2e-directeur-mot-de-passe";
export const ADMIN_SECRET = "e2e-secret-de-test-0123456789abcdef0123456789abcdef";
