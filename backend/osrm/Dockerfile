# Serveur d'itinéraires de Zedeka (OSRM) avec le réseau routier du Togo, lancé dans Cloudflare Containers par le
# Worker zedeka-api (src/osrm.ts). L'image est reconstruite à chaque déploiement de l'API : la carte suit les
# corrections faites dans OpenStreetMap (extrait Geofabrik, mis à jour chaque jour).
ARG OSRM_IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1

FROM ${OSRM_IMAGE} AS build
ARG PBF_URL=https://download.geofabrik.de/africa/togo-latest.osm.pbf
WORKDIR /data
ADD ${PBF_URL} /data/togo.osm.pbf
# Profil voiture : les motos empruntent les mêmes rues (pas les sentiers piétons). MLD : chargement rapide au démarrage.
RUN osrm-extract -p /opt/car.lua /data/togo.osm.pbf \
 && osrm-partition /data/togo.osrm \
 && osrm-customize /data/togo.osrm \
 && rm /data/togo.osm.pbf

FROM ${OSRM_IMAGE}
COPY --from=build /data /data
EXPOSE 5000
# Sans droits root (utilisateur « nobody ») : la carte est en lecture seule.
USER 65534:65534
CMD ["osrm-routed", "--algorithm", "mld", "--port", "5000", "--max-table-size", "50", "/data/togo.osrm"]
