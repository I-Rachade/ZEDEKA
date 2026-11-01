import { permanentRedirect } from "next/navigation";

// L'accueil du site est celui de l'application client : un seul visage pour Zedeka.
// Redirection permanente, pour que Google indexe /app comme page d'accueil.
export default function Home() {
  permanentRedirect("/app");
}
