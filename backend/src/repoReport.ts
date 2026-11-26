// Rapport du dépôt (workflow GitHub « Bilan quotidien », fichier bilan.json de la branche « bilan ») à l'heure pour le
// bilan de 6 h. GitHub lance les workflows planifiés avec plusieurs heures de retard (vers 16 h au lieu de 5 h 30) :
// l'API le lance donc elle-même à 5 h 30 (secret GITHUB_DISPATCH_TOKEN), et refait le bilan à 7 h si le rapport lu
// à 6 h date encore d'un jour précédent.

const WORKFLOW = "bilan-quotidien.yml";
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Lance le workflow sur la branche par défaut du dépôt. Jeton GitHub à grain fin limité à ce dépôt, droit « Actions :
// lecture et écriture ». Renvoie false sans jeton ou si GitHub refuse (rien n'est levé : le cron continue).
export async function dispatchRepoReport(token: string | undefined, repo: string, fetcher: Fetcher = fetch): Promise<boolean> {
  if (!token) return false;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "zedeka-api",
  };
  const info = await fetcher(`https://api.github.com/repos/${repo}`, { headers });
  if (!info.ok) return false;
  const { default_branch: ref } = (await info.json()) as { default_branch?: string };
  if (!ref) return false;
  const res = await fetcher(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ ref }),
  });
  return res.status === 204;
}

// Rapport du bilan absent ou fait un jour précédent (colonne SecurityAudit.ci, JSON ; jours en UTC, heure de Lomé) :
// le bilan doit être refait.
export function reportIsStale(ci: string | null | undefined, now: Date): boolean {
  if (!ci) return true;
  try {
    const at = Date.parse((JSON.parse(ci) as { generatedAt?: string }).generatedAt ?? "");
    return !(at >= Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } catch {
    return true;
  }
}
