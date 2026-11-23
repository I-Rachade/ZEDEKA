# Journal des versions

## 2.0.0 (en cours)

### Zedeka+, fidélité et publicité dans l'appli

- Zedeka+ : abonnement des clients (2 500 FCFA par mois par défaut) qui offre la livraison des repas dès 3 000 FCFA de panier (remise et panier minimum réglables). Le client le demande dans Profil > Fidélité et Zedeka+ ; l'équipe est prévenue (finances), encaisse en espèces ou mobile money et l'active dans Admin > Zedeka+ (1 à 12 mois, prolongation, arrêt, recherche d'un client). La remise s'applique d'office à la caisse, sans se cumuler avec un code promo ni une livraison offerte.
- Points de fidélité : 1 point par 100 FCFA du total des commandes livrées (repas, colis, boutiques) à partir du 23 novembre 2026 ; 300 points valent une livraison offerte, proposée à la caisse avec celles du parrainage (« Utiliser une livraison offerte »). Une commande annulée rend ses points.
- Défis des livreurs : Admin > Défis livreurs lance un objectif (nombre de livraisons sur une période, prime) ; le livreur suit sa progression dans « Mes défis » ; l'équipe voit le classement et note la prime versée (le livreur est prévenu).
- Mises en avant payées : Admin > Mises en avant place un restaurant ou une boutique en tête des listes avec le badge « Sponsorisé », à la semaine (5 000 FCFA par défaut), jusqu'à une date de fin.
- Réglages : nouvelle section « Zedeka+, fidélité et mises en avant ».
- Migration 0063 (additive) : tables PlusPayment, DriverChallenge, DriverChallengeReward et SponsorPayment ; colonnes sur Customer, Order, Restaurant et Settings.

### Assurance et micro-crédit des livreurs

- Appli livreur > Profil > Assurance et crédit : demande d'assurance (accident, moto, santé, responsabilité civile) ou de micro-crédit (réparation, équipement, apport pour une moto, urgence ; montant et durée), suivi de chaque étape, partenaire, montant accordé, remboursements avec une barre de progression ; déclaration de sinistre sur une assurance en cours. Une demande se retire tant qu'elle n'est pas transmise. Un seul crédit à la fois.
- Admin > Assurance et crédit : demandes à traiter, transmission à un partenaire (nom et référence saisis à la main, aucun partenaire branché), acceptée ou refusée, contrat en cours (montant accordé, total dû, mensualité ou prime, dates), remboursements et primes notés (espèces, Flooz, T-Money), clôture automatique du crédit remboursé. Le livreur est prévenu à chaque étape.
- Migration 0077 (additive) : tables RiderFinance et RiderFinancePayment.

### Recharge et échange de batteries ouverts à toutes les motos

- Page publique /recharge : stations de Zedeka (recharge sur borne, échange de batterie ou les deux), prix, horaires, itinéraire. Réservation d'un créneau sans compte (nom, numéro, plaque) jusqu'à 7 jours à l'avance, ticket avec un code à montrer à la station, annulation, ticket retrouvé avec le code et le numéro. Trois réservations à venir au plus par numéro ; le dernier créneau n'est jamais vendu deux fois.
- Admin > Recharge : réservations du jour (par station, recherche par code, plaque ou numéro), passage sans réservation, arrivée, fin de séance payée (espèces, Flooz ou T-Money avec la référence), absent, annulé ; stations (bornes, baies d'échange, prix, horaires, durée des créneaux). Chiffres du jour et du mois, dont les motos hors Zedeka.
- Appli livreur > Profil : lien vers la recharge.
- Migration 0076 (additive) : tables ChargingStation et ChargingBooking.

### Logistique des e-commerçants, gestion de stock et caisse (POS)

- Appli marchand > Stock : articles avec prix de vente, référence, seuil d'alerte, stock en boutique et stock à l'entrepôt Zedeka, entrées et sorties avec motif, historique des mouvements. Alerte « stock bas » quand le stock total atteint le seuil.
- Appli marchand > Caisse : vente au comptoir du stock boutique (prix de la fiche, jamais au-delà du stock), remise, espèces avec monnaie à rendre ou Flooz / T-Money avec la référence, ticket numéroté imprimable, ventes du jour par moyen de paiement, articles les plus vendus, annulation le jour même (articles remis en stock). Une vente renvoyée après une coupure n'est pas comptée deux fois.
- Appli marchand > Logistique : dépôt de marchandise annoncé (pris ou non dans le stock boutique), compté par l'équipe à l'entrepôt ; expédition d'un colis depuis l'entrepôt (ramassage à l'entrepôt, paiement à la livraison reversé comme avant) ; retours ; frais logistiques. Sur un colis : articles sortis de l'entrepôt, demande de retour (en route, ou 14 jours après la livraison).
- Admin > Logistique : dépôts à recevoir (quantités comptées, emplacement), colis à préparer, stock de chaque marchand (corrections avec motif), retours (à ramener, à l'entrepôt, remis en stock ou rendu au marchand, avec ou sans frais), frais à retenir, réglages de l'entrepôt (adresse : vide = stockage fermé, stockage 25 F par article et par mois, retour 500 F).
- Colis de marchand annulé par l'équipe : articles remis en stock avant le ramassage, retour ouvert après. Frais de stockage du mois calculés le 1er du mois ; frais retenus sur le prochain reversement du marchand, dans la limite du montant reversé.
- Migration 0075 (additive) : tables StockItem, StockMovement, StockDeposit, ParcelReturn, LogisticsCharge et PosSale, une colonne sur Order (stockLines), cinq réglages.

### Écran du bureau (Raspberry Pi + grand moniteur)

- Nouvelle page /ecran pour un moniteur au bureau, en rotation automatique (ou fixe avec `&vue=compteur` / `&vue=carte`) : livraisons du jour en grand, jauge de l'objectif, comparaison avec hier à la même heure, record, chiffres du jour (reçues, en cours, repas, colis, boutiques, temps moyen, courses Zed), commandes heure par heure, classement des livreurs du jour et fil des commandes en direct ; carte avec restaurants et boutiques (ouverts, commandes en cours), livreurs (libres, en course, sans position) et compteurs du terrain.
- Motivation : bandeau et sonnerie à chaque nouvelle commande, confettis et fanfare toutes les 10 livraisons, à l'objectif du jour et au record battu.
- Temps réel par le canal de l'équipe (WebSocket), relectures régulières en secours, rechargement toutes les 6 h, écran gardé allumé.
- Admin > Écran du bureau (directeur) : création des liens d'écran (clé montrée une seule fois, seule son empreinte est gardée), révocation, objectif du jour (sinon automatique : moyenne des 7 derniers jours + 10 %). Accès en lecture seule, sans téléphone, adresse ni nom de client ; livreurs affichés par prénom et initiale.
- Guide d'installation sur Raspberry Pi (Chromium kiosque, démarrage automatique, pas de mise en veille) : `ecran-bureau/` dans les fichiers du projet.
- Migration 0074 (additive) : table DisplayScreen et réglage screenDailyGoal.

### Ressources humaines et comptabilité dans l'admin

- Deux nouveaux rôles d'équipe (Admin > Équipe) : « Ressources humaines » et « Comptable ». Chacun n'ouvre que ses écrans ; l'administrateur adjoint consulte les deux sans les modifier ; le directeur garde tout. Aucun rôle existant ne change.
- Admin > Ressources humaines : fiches des employés (identité, contact, CNSS, poste, service, contrat CDI/CDD/stage/prestataire/journalier, essai et fin de contrat, salaire, mode de paiement), départs, fiches créées d'un clic pour les livreurs salariés, congés et absences (demande, acceptation, solde des congés payés au prorata, jours du lundi au samedi), documents (PDF ou photo, dans R2), alertes des fins de contrat et d'essai à 30 jours, paie du mois (salaire de la fiche, retenue des absences non payées à salaire ÷ 26 par jour, primes et retenues, validation, export CSV).
- Admin > Comptabilité : comptes de trésorerie (caisse, mobile money, banque) avec soldes, journal des recettes et dépenses par catégorie (une écriture ne s'efface pas : elle s'annule avec son motif), virements entre comptes, paiement des salaires validés par les RH (écrit au journal), synthèse d'une période avec les chiffres de la plateforme (revenu des commandes, espèces des livreurs, reversements, leasing, plans Zed, abonnements), paiements des livreurs, abonnements des commerces, export CSV pour Excel.
- Le comptable ouvre aussi Finances, Rapport et Leasing motos (consultation, confirmation des paiements et espèces au bureau).
- Migration 0073 (additive) : tables Employee, EmployeeLeave, EmployeeDocument, Payslip, FinanceAccount et LedgerEntry.

### Plaque de la moto du parc dans « Ma moto » (livreurs salariés)

- « Ma moto » (profil et accueil) montre au salarié la plaque, le modèle et la photo de la moto du parc avec laquelle il travaille aujourd'hui, et qui la lui a donnée (répartition) ou s'il l'a prise lui-même.
- Check-in avant le service : le salarié prend sa moto du jour, ou en change, depuis « Ma moto », sans passer en ligne. Refusé pendant une course (le client suit la plaque).
- Quand la répartition ou le directeur attribue une moto, le livreur reçoit une notification avec la plaque.
- Aucune migration.

### Nettoyage (fusion restaurants et boutiques, étape 6)

- L'ancienne boutique de l'application marchand est retirée : écrans produits, bannières, vente en ligne, aperçu et commandes boutique, leurs routes d'API, la fiche boutique côté client et l'onglet « Vente en ligne » de l'admin. Les boutiques passent par l'espace commerce, comme les restaurants.
- Migration 0062 (accordée par le directeur) : suppression des tables vides Product, StoreBanner et StoreOrderItem, et de la colonne Reel.productId (table Reel reconstruite, likes et commentaires conservés).

### Argent (fusion restaurants et boutiques, étape 5)

- Reversement par mobile money : chaque commerce peut avoir un numéro mobile money (fiche admin, ou « Horaires et réglages » pour le gérant). Dans Finances, un relevé se règle « en espèces » ou « par mobile money » au numéro du commerce, avec la référence de la transaction ; le relevé garde qui l'a noté. Le commerce voit dans ses relevés comment il a été payé.
- Le revenu Zedeka compte les boutiques comme les restaurants : ce sont maintenant des commerces, avec la même commission ou le même abonnement.
- Migration 0061 (additive) : une colonne sur Restaurant (payoutPhone) et quatre sur RestaurantSettlement (payoutMethod, payoutPhone, payoutRef, paidBy).

### Leasing de motos aux livreurs indépendants

- Admin > Leasing motos : contrats des motos louées aux livreurs et conducteurs indépendants validés (une moto à la fois), au jour : moto rechargeable à la maison (1 000 FCFA) ou moto Zedeka (2 000 FCFA), prix par défaut dans Réglages et figé sur le contrat. Paiements mobile money à confirmer, espèces encaissées sur la fiche du contrat, fin du contrat (moto rendue). Bouton « Moto en leasing » sur les livreurs indépendants.
- Appli livreur : carte sur l'accueil et écran « Ma moto » (payé jusqu'au…, montant dû, paiement Flooz ou T-Money avec la référence, historique). Le leasing s'ajoute aux frais d'application.
- Rappels : un par jour au livreur en retard ou à son dernier jour payé ; l'équipe (finances) prévenue à 3 jours de retard. Blocage de la mise en ligne après un nombre de jours réglable (0 par défaut : jamais).
- Revenu du leasing ajouté aux revenus fixes du tableau de bord et du rapport.
- Migration 0060 (additive) : tables LeaseContract et LeasePayment, trois réglages.

### Offres : palier Pro, tarif boutique et parrainage

- Palier Pro des commerces : choix Essentiel ou Pro dans la fiche (Admin > Commerces). Changer de palier applique son prix (Pro : 35 000 FCFA/mois, dans Réglages), sauf prix saisi à la main. La fiche montre les commandes livrées du mois ; au-delà de 300 (réglable), la liste signale « Pro conseillé ». L'espace commerce affiche « Abonnement Zedeka Pro ».
- Tarif boutique : une boutique de l'appli marchand qui a déjà envoyé 20 colis dans le mois paie 800 FCFA la livraison des suivants, jamais plus cher que le prix au km (suppléments de type et de poids en plus). Le prix fixe reste acquis quand le destinataire partage sa position. L'écran « Envoyer » le rappelle. Seuil et prix dans Réglages (seuil 0 : coupé).
- Parrainage : Profil > Parrainage donne un code à partager sur WhatsApp. Un nouveau client entre le code d'un ami avant sa première commande livrée ; à cette livraison, l'ami gagne une livraison offerte. À la caisse, « Utiliser une livraison offerte » retire les frais de livraison (sans code promo, en livraison) ; une commande annulée rend la livraison offerte.
- Migration 0059 (additive) : colonne plan sur Restaurant, quatre réglages, colonnes de parrainage sur Customer, flatRate et referralCredit sur Order.

### Temps réel des commandes

- Les écrans ouverts (suivi client, appli client, espace commerce, appli livreur, marchand, admin) gardent une connexion WebSocket avec l'API (Durable Object « Live »). Dès qu'une commande change (nouvelle, acceptée, prête, livreur attribué ou retiré, récupérée, livrée, annulée), l'écran se met à jour en moins d'une seconde au lieu d'attendre sa relecture (5 à 15 s).
- Le signal ne contient aucune donnée : l'écran relit ses informations par les routes habituelles. Un ticket signé, valable 5 minutes, ouvre la connexion. Les relectures régulières restent en secours si la connexion tombe.
- Pas de migration de base de données (nouvelle classe Durable Object « Live » dans wrangler.jsonc).

### Espace commerce (fusion restaurants et boutiques, étape 4)

- L'espace /restaurant devient « Espace commerce ». Une boutique n'y voit ni le mode caisse ni les tables, mais une page « Bannières » pour gérer elle-même ses images et vidéos ; sa carte s'appelle « Articles » et « En cuisine » devient « En préparation ». Un restaurant garde tout comme avant.
- Connexion du gérant par numéro et code PIN, en plus de l'e-mail et du mot de passe. L'équipe crée le PIN dans la fiche du commerce, le gérant le change dans « Mon compte » (avec son mot de passe ou l'ancien PIN). 5 essais faux bloquent 15 minutes.
- Migration 0056 (additive) : trois colonnes sur Restaurant (pinHash, pinAttempts, pinLockedUntil).

### Côté client (fusion restaurants et boutiques, étape 3)

- La tuile « Boutiques » liste aussi les commerces de type boutique ; ils s'ouvrent sur leur page /r/…, avec le même panier et la même commande que les restaurants. La liste des restaurants ne montre plus que les restaurants.
- Les bannières du commerce s'affichent en haut de sa page ; une image liée à un article ouvre sa fiche.
- Les mots suivent le type : « article » et « boutique » au lieu de « plat » et « restaurant », « En préparation » au lieu de « En cuisine » dans le suivi de commande.
- Pas de migration.

### Type de commerce (fusion restaurants et boutiques, étape 2)

- Un commerce est un restaurant (par défaut) ou une boutique, avec sa catégorie (mode, beauté, épicerie…). L'admin le choisit à la création et dans la fiche ; la page « Restaurants » de l'admin s'appelle maintenant « Commerces ».
- Bannières : jusqu'à 8 images ou vidéos en haut de la page d'un commerce, qui peuvent mener à un article ; gérées dans la fiche du commerce (l'affichage côté client vient à l'étape 3).
- Vérification des nouveaux articles en option : cochée, un article ajouté par le commerce reste masqué et l'équipe est prévenue ; elle le rend disponible après l'avoir regardé.
- Migration 0055 (additive) : trois colonnes sur Restaurant (kind, shopCategory, reviewNewItems) et la table RestaurantBanner.

### Catalogue enrichi (fusion restaurants et boutiques, étape 1)

- Un plat peut avoir jusqu'à 4 photos en plus de sa photo principale ; le client les fait défiler dans la fiche du plat.
- Choix du client sans changement de prix (ex. « Sauce : Arachide, Tomate », « Cuisson ») : jusqu'à 5 questions par plat, une réponse obligatoire pour chacune. La réponse s'affiche partout avec le plat (cuisine, livreur, reçu) et « Commander à nouveau » la reprend.
- Stock facultatif : vide, le plat est illimité ; sinon chaque commande le diminue, jamais sous zéro, et à 0 le plat s'affiche « Épuisé ». Une commande annulée ne remet pas le stock : le gérant le corrige dans la carte.
- Migration 0054 (additive) : trois colonnes sur MenuItem (imageUrls, options, stock).

### Règles et textes remis d'accord avec l'application

- Annulation : une seule règle partout (caisse, colis, politique, conditions). Gratuite pendant le délai des Réglages tant que le repas n'est pas en préparation et le colis pas récupéré ; ensuite le pourcentage des frais de livraison, retenu seulement sur une somme déjà payée. En espèces à la livraison, rien n'est dû, et la commande n'affiche plus de frais qui ne seront jamais payés.
- Conditions générales : plus de « hausse de prix » (un restaurant ne peut que retirer ou remplacer par moins cher, la différence est remboursée) ; client injoignable : les frais de la politique, plus « tous les frais » ; nouvel article 8 pour le Zed, les services à domicile et les boutiques.
- Code de remise : un nom de l'histoire africaine suivi de 2 chiffres, par ex. « NZINGA 42 » (100 noms, autant de codes possibles que les 4 chiffres d'avant). Le livreur peut le taper en minuscules ou sans espace ; les codes à 4 chiffres des courses déjà en route restent valables.
- Code de remise et PIN : le code de remise est nommé « Code de remise à donner au livreur » et rappelle que ce n'est pas le PIN ; le PIN dit que le livreur ne demande que le code de remise.
- Commande prête : « Prête au restaurant » au lieu de « Prête, un livreur arrive » (aucun livreur n'est encore choisi à ce moment) ; côté boutique, « Prête, en attente du livreur ».
- Lien de suivi partagé : point de livraison arrondi à environ 100 m, et seulement avec un code long (les anciens codes courts, faciles à deviner, ne montrent rien).
- Tableau de bord et rapport : le revenu compte aussi les abonnements des boutiques en ligne, la part du jour des plans Zed et les frais d'annulation retenus.
- Marchand : un colis s'annule jusqu'à ce que le livreur l'ait récupéré, comme le dit la politique ; la course est retirée au livreur.
- Facturation par zone : la liste des restaurants prend la même zone que la commande (celle de la position du client d'abord).
- README remis à jour (connexion par PIN, SMS par Didit, inscription des conducteurs Zed, écran Zones, annulation, revenu).

### Annuler soi-même, statuts plus clairs

- Suivi de commande : bouton « Annuler sans frais » avec le temps restant, sur le téléphone ou le compte qui a commandé, pendant l'annulation gratuite et avant la préparation. Le restaurant et l'équipe sont prévenus, la course est retirée au livreur. Ensuite, l'aide WhatsApp prend le relais.
- Mêmes mots pour les étapes dans toutes les applis : « En cuisine » (au lieu de « En préparation ») et « En route » (au lieu de « En livraison »), « Acceptée » sur le suivi.
- Tableau de bord, « À traiter » : alerte si un livreur indépendant est actif alors que sa part par course est à 0 % dans les Réglages.

### Suivi d'une livraison par lien ou par code

- Lien de suivi envoyé à quelqu'un sans l'appli : la page montre maintenant la carte en direct (départ, arrivée, position du livreur) et le prénom du livreur avec sa moto, sans numéro de téléphone, sans messages, sans adresse écrite ni photo. Plus de position une fois la livraison terminée.
- Onglet « Commandes » : champ « Suivre une livraison avec son code » (ex. ZD-ZVKE-7CDX, minuscules et espaces acceptés).

### Messagerie écrite entre le client et le livreur

- Dès que le livreur a accepté la course, le client lui écrit depuis le suivi (« Écrire à Koffi ») et le livreur répond depuis sa course (« Écrire au client »), avec des réponses rapides (« Je suis arrivé », « Je descends »…).
- Messages marqués « Lu », nombre de non lus sur les boutons, notification à chaque message (livreur, et client avec un compte).
- Nouvel écran « Messages » du client : onglets Actifs et Archives. On l'ouvre par l'icône de messagerie en haut de l'accueil, à côté de la cloche (elle remplace le rond du compte, toujours dans l'onglet Profil), par la ligne « Messages » du compte et par le bouton de « Mes commandes » ; pastille rouge des non lus partout.
- Après la livraison ou l'annulation, la conversation reste lisible en lecture seule ; l'équipe la retrouve dans le détail de la commande (admin).
- Un livreur repris sur une course ne lit pas ce qui a été écrit avec le précédent ; les messages sont effacés avec le compte du client.
- Migration additive `0052_messagerie_livreur_client.sql` (table `ChatMessage`).
- WhatsApp direct avec le livreur : sur le suivi, sous « Écrire à … », un bouton « WhatsApp avec … » ouvre WhatsApp sur le numéro du livreur (message ou appel). Donné seulement au compte ou à l'appareil qui a commandé, et seulement de l'acceptation de la course à la livraison ; la page ouverte avec le seul code (lien partagé) ne le montre jamais.
- Même règle pour le bouton d'appel vert de la carte du livreur : il appelle directement le numéro du livreur ; pour un lien partagé, il passe toujours par Zedeka.

### Revue générale : corrections (livreurs, Zed, favoris, finances, rôles)

- Appli du livreur : « Espèces en main » et le compteur de l'accueil font le même calcul que l'admin (avance payée aux restaurants déduite, commandes mobile money où Zedeka doit l'avance comprises).
- Commande en espèces cochée « payé » avant la remise : 0 reçu est enregistré, l'admin ne réclame plus le total au livreur.
- Code promo payé par le restaurant : retenu aussi sur le dépôt et sur ce que le livreur indépendant paie au restaurant.
- Caisse : un retrait encaissé au comptoir passe en espèces (plus de double paiement si le mobile money était prévu).
- Un livreur avec un client Zed accepté ou à bord (ou une alerte Zed en attente) ne reçoit plus de livraison.
- Course Zed réservée : à l'heure, elle n'est confiée au conducteur que s'il est encore disponible ; sinon elle part en recherche.
- Course Zed : une seule alerte part même si l'écran du client et l'appli du conducteur font avancer la course ensemble.
- Retrait réservé pour plus tard : il ne bloque plus les appels Zed ni le rendu de la moto du parc.
- Moto du parc rendue quand le salarié est mis hors ligne automatiquement, ou quand il termine la course après sa fin de service.
- Livreur favori : invitation par numéro quel que soit le format saisi ; colis programmés proposés aux favoris avant les autres ; favoris essayés comptés colis par colis.
- Dispatcheur : remise et case « payé » réservées au directeur, à l'adjoint et à la managerin.

### Boutiques en ligne : corrections après revue

- Vente annulée par l'équipe depuis l'admin : les articles reviennent en stock et le marchand est prévenu.
- L'écran des colis du marchand ne montre plus les ventes de la boutique (ni annulation sans remise en stock, ni numéro du client avant acceptation).
- Prix changé pendant l'achat : la commande est refusée, le panier affiche les nouveaux prix avant une nouvelle confirmation.
- Un produit refusé par l'équipe repasse toujours en vérification, même dans une boutique de confiance.
- Pièce ou IFU et catégorie verrouillées dès la demande de mise en ligne : le marchand passe par Zedeka pour les changer.
- Reversement d'une vente : comme pour les colis, les espèces manquantes à la livraison sont retenues au marchand.
- Stock du marchand : il saisit le stock en main, les articles réservés par les commandes en cours sont comptés à part (plus de stock gonflé après un refus).
- Tableau de bord du marchand : le contre-remboursement du mois ne compte plus les ventes de la boutique.

### Boutiques en ligne (étape 2 : vente)
- Module « Boutiques » ouvrable (« Ouvert ») dans Admin > Services ; il reste coupé par défaut.
- Côté client : rubrique « Boutiques » par catégorie, rangée « Faire du shopping » sur l'accueil, page de la
  boutique (bannières, rayons, fiche produit avec tailles et couleurs), panier d'une seule boutique, livraison à sa
  position, à une adresse enregistrée ou sur la carte, paiement en espèces ou Mobile Money. Prix, stock et choix
  revérifiés par le serveur ; le stock est réservé à la commande et rendu si elle est annulée.
- Côté marchand : « Commandes » avec sonnerie, à accepter dans les 30 min (sinon annulée), « Le paquet est prêt »
  appelle un livreur Zedeka, refus avec un motif pour le client. Ce que la boutique touche (articles moins la part
  Zedeka) arrive sur « Argent » une fois livré.
- Les livreurs ne voient une commande de boutique qu'une fois le paquet prêt. Suivi client avec les étapes de la
  boutique et les articles ; Admin > Commandes filtre « Boutiques » et montre les articles et la part Zedeka.
- Migration 0051 (additive) : colonne `Order.storeSale` et table `StoreOrderItem`.

### Boutiques en ligne (étape 1 : catalogue et validation)
- Nouveau module « Boutiques » dans Admin > Services, coupé par défaut. « Bientôt » ouvre la préparation aux
  marchands et annonce la tuile aux clients ; la vente aux clients arrive à l'étape 2.
- Appli marchand : « Vendre en ligne » avec les produits (photos, prix, stock, rayon, tailles et couleurs), les
  bannières publicitaires en carrousel (images et vidéos, chacune peut ouvrir un produit), l'aperçu de la boutique
  telle que les clients la verront, et la demande de mise en ligne (catégorie, présentation, pièce ou IFU).
- Admin > Marchands > Vente en ligne : boutiques à valider, mise en ligne, refus ou suspension avec un motif montré
  au marchand, catégorie, et facturation comme les restaurants (commission en % ou abonnement mensuel). Les 5
  premiers produits d'une boutique sont vérifiés par l'équipe, les suivants sont publiés directement.

### Navigation
- Écran « Naviguer » dans l'application livreur, sans passer par Google Maps : carte Zedeka plein écran, tracé
  jusqu'au restaurant, au retrait ou au client, position du livreur en direct (flèche orientée), prochaine manœuvre
  (« 300 m, tournez à gauche ») dite à voix haute, temps, distance et heure d'arrivée. Recalcule seul quand le livreur
  quitte l'itinéraire, garde l'écran allumé, et annonce l'arrivée. Disponible sur la course, la course Zed (vers le
  client) et les missions. Google Maps reste en secours sur l'écran. Itinéraires par un service compatible OSRM
  (réseau routier d'OpenStreetMap).
- Serveur d'itinéraires propre à Zedeka, sur Cloudflare comme le reste : OSRM avec la carte du Togo dans Cloudflare
  Containers, démarré à la demande et arrêté après 30 min sans navigation, reconstruit avec la carte à jour à chaque
  déploiement de l'API. Le serveur public de démonstration OSRM ne sert plus qu'en secours.
- Fond de carte propre à Zedeka pour toutes les cartes : la carte du Togo (Protomaps, tirée d'OpenStreetMap) rangée
  dans R2 et servie par l'API, mise à jour chaque mois par le workflow « Carte du Togo ». Tuiles gardées au point de
  présence Cloudflare. Tant qu'elle n'est pas en place (ou avec `NEXT_PUBLIC_MAP_TILES`), les tuiles d'OpenStreetMap.

### Finances
- Forfait (dépôt) Zedeka chez les restaurants : seules les commandes livrées par un livreur salarié de Zedeka sont
  débitées du forfait (prix des plats moins la commission). Avec un livreur indépendant, c'est lui qui paie les plats
  au restaurant sur place : l'application lui affiche le montant au retrait, et Admin > Finances le déduit des
  espèces qu'il remet (ou le lui rembourse si le client a payé en mobile money). Les retraits payés en ligne restent
  débités comme avant.

### Corrections
- Espace restaurant : « Erreur 500 » de temps en temps quand plusieurs écrans chargeaient en même temps (tableau de
  bord, commandes, alarme). Deux requêtes partageaient une même lecture de la base et le Worker arrêtait la seconde.
- Base de données : les gestes faits au même moment ne s'écrasent plus (D1 n'a pas de transactions). Un livreur
  dont la course a été retirée ou a expiré ne peut plus l'accepter quand même ; l'admin ne change plus l'étape d'une
  commande que le restaurant ou le livreur vient de changer ; une commande annulée n'est plus marquée remise ; deux
  caisses ne peuvent plus encaisser deux fois ; deux modifications simultanées d'une commande ne comptent plus deux
  fois le remboursement ; un paiement Zed n'est validé qu'une fois ; une commande envoyée deux fois au même instant
  renvoie la première au lieu d'une « Erreur 500 ».

### Rapidité
- Vitesse réelle des téléphones (Core Web Vitals, sans donnée personnelle) dans Admin > Santé, et mesure
  « téléphone lent » du site en ligne chaque matin (onglet Actions).
- Accueil et carte des restaurants gardés 20 s en mémoire par l'API (vidé à chaque modification), notes indexées.
- Délais maximum sur Firebase, Web Push, Didit et Cloudflare Access ; plus de lectures ni de recherches en double.
- Admin > Commandes par pages de 50 ; historique sans compte en un seul appel.
- Photos en WebP (environ 30 % plus légères), squelettes des pages serveur, gestes instantanés côté restaurant.

### En un geste
- Restaurant : l'alarme de nouvelle commande montre la commande (plats, montant, livraison ou table) et l'accepte
  d'un geste, « Accepter · 15 min » ; « Voir le détail ou refuser » ouvre la fiche. Accepter met toujours la commande
  en cuisine (plus d'étape « Lancer la préparation »), 15 min proposées par défaut.
- Restaurant : « Prête » prévient aussi le livreur déjà affecté ; le bouton devient « Livreur prévenu · relancer ».
  Quand le temps annoncé est dépassé, un bip et un bouton vert « C'est prêt ? Touchez ici » le rappellent.
- Client connecté avec une adresse enregistrée : la caisse s'ouvre directement sur le récapitulatif (« Modifier »
  sur chaque ligne). Le dernier moyen de paiement est repris, et « Commander à nouveau » mène droit à la caisse.
- Livreur : à la remise, le montant exact est proposé d'office ; « Autre montant ? » ouvre le champ.

### Restaurants
- Sonnerie de table : depuis le QR code de sa table, le client appelle le serveur, demande l'addition (espèces ou
  mobile money) ou écrit une demande. L'espace restaurant (mode caisse compris) affiche un bandeau « Table 7 » et
  sonne, avec une notification push, jusqu'à « J'arrive » ; le client voit que le serveur arrive, puis « Fait »
  ferme l'appel. Relance au bout de 2 min sans réponse, un appel par table, nouvelle sonnerie après 30 s,
  fermeture automatique après 15 min. Interrupteur et temps moyen de réponse sur la page Tables et QR codes.

### Livreurs et prestataires
- Missions de service : les demandes des services de son profil, accepter (le premier gagne), en route, sur place,
  terminer avec les achats, le gaz ou les pièces payés ; « Je ne peux plus venir » renvoie la demande aux autres.

### Admin
- Demandes de service : suivi, attribution ou réattribution à un prestataire, annulation avec raison ; services de
  chaque livreur (il reçoit les demandes de ces services). Page Services : tarif de chaque service (base + unité).

### API
- Demandes de service : 3 en cours au plus par client, 2 par minute et 10 par jour, créneau de 7 h à 19 h dans les
  14 jours, prix calculé côté serveur, 3 missions en cours au plus par prestataire, prise de mission atomique.
  Migration 0037 (ajouts seulement).

### Clients (applis et web)
- Cinq services à la demande sous le bouton Services : Courses pour moi (liste et budget), Gaz et eau (bouteille
  6 ou 12 kg, bidons), Lessive (sacs, repassage, créneau), Ménage (maison ou bureau, heures, créneau) et Dépannage
  (plomberie, électricité, autre, créneau). Formulaire avec estimation du prix, suivi en cinq étapes (envoyée,
  acceptée, en route, en cours, terminée), numéro du prestataire pendant la mission, total à payer, note, annulation.
  Volet « Services » dans Mes commandes.
- Le bouton du milieu devient « Services » (carré aux coins arrondis) : livraison et transport en haut (colis, course
  Zed), puis les autres services (courses, gaz et eau, lessive, ménage, dépannage) quand l'admin les annonce
  (« Bientôt », non cliquables tant qu'ils ne sont pas prêts). Aucun module visible : la barre garde quatre onglets.
- Recherche : trouve aussi les services (« linge » → Lessive, « moto » → Course Zed).
- Colis coupé dans l'admin : la page /colis l'indique et l'API refuse les nouveaux colis.
- Bouton Zed toujours au centre de la barre : il ouvre « Envoyer un colis » ou « Une course pour moi ».
- Accueil réservé aux restaurants (les cases Repas et Colis disparaissent).
- Page Zed en deux volets glissables : Colis et Course Zed.
- Mes commandes en trois volets glissables : Repas, Colis et Courses Zed (historique des courses).
- Suivi : détail complet de la livraison (expéditeur, destinataire, position, type, poids, taille, note, qui paie,
  plaque du livreur), visible par qui a commandé ; on glisse d'une commande en cours à l'autre.
- Course Zed : le bouton « Appeler un Zed » reste visible au-dessus de la barre, sans défiler.
- Zed : destination facultative (« Je vais à »), montrée au conducteur avant d'accepter.
- Sans réseau : l'accueil, les menus des restaurants déjà ouverts, Colis, Zed, Mes commandes et le suivi restent
  affichés depuis le téléphone (dernière version reçue), avec un bandeau « Hors ligne ». Rien de personnel n'est
  gardé par le service worker ; une page jamais ouverte affiche « Pas de réseau ».

### Livreurs et conducteurs Zed
- Appel et course Zed : destination du client affichée.
- Fin de course : prix convenu en un geste (300, 400, 500, 700 F) ou autre montant.
- Accueil : date de fin du plan Zed et nombre de courses Zed du jour.

### Restaurants et administration
- Connexion perdue : les pages gardent ce qu'elles montraient (copie sur l'appareil, effacée à la
  déconnexion), avec l'heure de la dernière mise à jour, et se rechargent seules au retour du réseau.
- Admin : nouvelle page « Services » (directeur ; l'adjoint en lecture) : chaque module du bouton du milieu se règle
  seul (Ouvert, Bientôt, Caché) et dans l'ordre voulu. La course Zed suit le réglage « Mode Zed ». Un service pas
  encore construit ne peut pas être ouvert. API : /api/services servie depuis un cache en mémoire (30 s) avec ETag
  (304 sans corps) ; l'appli affiche aussitôt la dernière liste gardée sur le téléphone.
- Admin : nouvelle page « Santé » (directeur et adjoint) : temps de réponse du serveur et de la base, activité
  du jour, dernière activité de chaque appli, livreurs sans signal et commandes ouvertes depuis plus de 1 h 30.

### Marchands e-commerce (nouvelle appli)
- Appli marchand `/marchand` (et APK « Zedeka Marchand », `com.zedeka.marchand`) pour les boutiques en ligne qui
  envoient surtout des colis. Même compte que l'appli client (numéro ou e-mail et PIN), avec un profil boutique.
- Envoi groupé : jusqu'à 50 colis d'un coup, saisis un par un ou collés depuis un tableur ou WhatsApp
  (« Nom ; Téléphone ; Adresse ; Montant ; Réf »), prix ligne par ligne avant de valider.
- Contre-remboursement : le livreur encaisse le prix des articles chez le client ; la livraison est payée par la
  boutique (retenue sur le reversement) ou par le client. Le livreur voit simplement le montant à encaisser.
- Pour chaque client : message WhatsApp prêt à envoyer avec le lien de position (24 h) ou le lien de suivi.
- Ramassage habituel (jours et heure) et bouton « Venez ramasser maintenant » qui prévient l'équipe.
- Argent : solde à recevoir, colis pas encore reversés, historique des reversements.
- Admin : page « Marchands » (boutiques, ramassages demandés, solde, suspendre, reverser).

### Base de données
- Migration additive `0030_destination_zed.sql` : colonne `destination` des courses Zed.
- Migration additive `0033_marchands.sql` : tables `Merchant` et `MerchantPayout`, colonnes `merchantId`,
  `codAmount`, `merchantRef` et `merchantPayoutId` des commandes.

## 1.0.0 (4 novembre 2026)

Première version figée de Zedeka : tout ce qui est en ligne sur `zedeka.poinderecharge.com` au 4 novembre 2026
(jusqu'à la PR #72). Branche de conservation : `release/1.0`, étiquette : `v1.0.0`.

### Clients
- Commande de repas en 3 étapes : recherche, catégories, filtres, panier, caisse avec point de livraison sur la carte.
- Envoi de colis en 3 étapes : types de colis, prix à la distance, position du destinataire par lien partagé,
  paiement par l'expéditeur ou le destinataire.
- Mode Zed : moto-taxi à la demande, bouton flottant dans la barre client.
- Commande à table avec QR code numéroté.
- Connexion par code PIN avec le téléphone ou l'e-mail, codes envoyés par SMS (Didit).
- Suivi des commandes quasi instantané, notifications (application et navigateur), clôture de la livraison
  et notes du livreur et du restaurant.
- Horaires d'ouverture et prochaine ouverture affichés, bannière publicitaire en carrousel sur l'accueil.
- Interface façon Apple, en français et en anglais.

### Restaurants
- Espace restaurant : commandes, carte avec photos des plats et logo envoyés depuis l'appareil.
- Équipe : caissières et manageuses ; mode caisse avec trois affichages.
- Abonnement fixe des commerces partenaires, retraits payés au comptoir.

### Livreurs
- Inscription et connexion par numéro ou e-mail et code PIN.
- Étapes une par une : ramassage puis livraison, livreur visible par le client après acceptation.

### Administration
- Centre de notifications pour toute l'équipe, compteurs d'activité, rôles Managerin et Administrateur adjoint.
- Attribution automatique, appel et WhatsApp, gestion des restaurants, livreurs, zones, horaires et publicités.
- Livraison au km ou par zone au choix dans les réglages.

### Applications Android
- Quatre applications Capacitor : client, livreur, restaurant et admin (APK de test et .aab pour le Play Store).

### Technique, sécurité et conformité
- Hébergement Cloudflare (Workers, base D1, fichiers R2), déploiement automatique depuis la branche principale.
- Sécurité : limites de débit, codes à usage unique, protections SSRF et CSP, accès admin derrière Cloudflare Access.
- Conformité Togo : mentions légales, CGU/CGV, confidentialité, cookies, consentement, suppression des comptes
  et des données.
- Rapidité : fichiers gardés en cache, accueil instantané, vignettes des photos, index de la base D1.
- Tests de bout en bout avec Playwright.
