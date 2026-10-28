import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Pas de cache incrémental : toutes les pages qui lisent l'API sont rendues à chaque visite.
export default defineCloudflareConfig();
