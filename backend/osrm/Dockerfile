# Serveur d'itinéraires de Zedeka (OSRM) avec le réseau routier du Togo, lancé dans Cloudflare Containers par le
# Worker zedeka-api (src/osrm.ts). L'image est reconstruite à chaque déploiement de l'API : la carte suit les
# corrections faites dans OpenStreetMap (extrait Geofabrik, mis à jour chaque jour).
ARG OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1

# Téléchargement de la carte : Geofabrik d'abord, puis le miroir d'OpenStreetMap France. Geofabrik a déjà répondu
# 404 aux machines de build de Cloudflare (alors qu'il répond à GitHub) : un seul site ne doit plus bloquer la mise en
# ligne de l'API. Plusieurs essais par site, et un fichier trop petit (page d'erreur) est refusé.
FROM curlimages/curl:8.11.1 AS map
ARG PBF_URLS="https://download.geofabrik.de/africa/togo-latest.osm.pbf https://download.openstreetmap.fr/extracts/africa/togo-latest.osm.pbf"
WORKDIR /tmp
RUN for url in $PBF_URLS; do \
      for try in 1 2 3; do \
        if curl -fsSL --connect-timeout 20 --max-time 600 -A "zedeka-osrm-build" -o togo.osm.pbf "$url" \
          && [ "$(stat -c %s togo.osm.pbf)" -gt 1000000 ]; then echo "carte : $url"; exit 0; fi; \
        echo "échec ($try) : $url" >&2; sleep 5; \
      done; \
    done; \
    echo "Carte du Togo introuvable sur tous les sites" >&2; exit 1

FROM ${OSRM_IMAGE} AS build
WORKDIR /data
COPY --from=map /tmp/togo.osm.pbf /data/togo.osm.pbf
# Profil voiture : les motos empruntent les mêmes rues (pas les sentiers piétons). MLD : chargement rapide au démarrage.
RUN osrm-extract -p /opt/car.lua /data/togo.osm.pbf \
 && osrm-partition /data/togo.osrm \
 && osrm-customize /data/togo.osrm \
 && rm /data/togo.osm.pbf \
 # OSRM écrit ses fichiers en lecture pour lui seul : lisibles par l'utilisateur sans droits du serveur.
 && chmod -R a+rX /data

FROM ${OSRM_IMAGE}
COPY --from=build /data /data
EXPOSE 5000
# Sans droits root (utilisateur « nobody ») : la carte est en lecture seule.
USER 65534:65534
CMD ["osrm-routed", "--algorithm", "mld", "--port", "5000", "--max-table-size", "50", "/data/togo.osrm"]
