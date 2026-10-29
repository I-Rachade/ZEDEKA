import { redirect } from "next/navigation";

// L'accueil du site est celui de l'application client : un seul visage pour Zedeka.
export default function Home() {
  redirect("/app");
}
