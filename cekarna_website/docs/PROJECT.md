# Cekarna — référence projet

**Périmètre actuel : B2C exclusivement.** Cekarna s’adresse aux particuliers en recherche d’emploi. Lire `B2C.md` pour le périmètre actif. Les éléments B2B ci-dessous sont un historique abandonné, à ne pas implémenter sans nouvelle instruction explicite.

## Service d’authentification demandé — 6 septembre 2026

L’utilisateur demande explicitement un microservice Go/Chi avec PostgreSQL et Redis.
Il est isolé dans `services/auth/` ; le socle NestJS est conservé. Voir
`../services/auth/README.md` pour le contrat HTTP, les migrations et les limites.
Le besoin est l’identité sécurisée et la gestion de sessions pour le B2C : secrets
de signature centralisés, vérification publique JWKS, rotation et révocation.
Cette décision constitue une exception explicite au report des services Go ci-dessous.

Coût ajouté : un processus Go, une base PostgreSQL sauvegardée, un Redis privé,
gestion de secrets et supervision. Base de dimensionnement à mesurer : 512 Mio
pour Go (4 Argon2id simultanés), 128 Mio de données Redis pour le développement ;
PostgreSQL dimensionné selon utilisateurs, sessions, audits et rétention.
Pas de coût mensuel annoncé sans choix d’hébergeur et charge. Formulaires web
raccordés le 6 septembre 2026 ; vérification email et récupération de mot de
passe livrées (transport `log` en développement, SMTP direct ou file Rust
`services/notifications` configurable en production). Avec la file Rust, une
outbox PostgreSQL conserve l'intention d'email jusqu'à son acceptation ou son
expiration. MFA/passkeys : tranche B
spécifiée dans `docs/superpowers/specs/2026-09-06-auth-passkeys-tranche-b-design.md`,
mais non implémentée. Les données du
candidat sont synchronisées avec PostgreSQL pour les comptes connectés et restent
disponibles localement comme repli.

## Objectif historique abandonné

État du code et écarts constatés : voir [AUDIT.md](AUDIT.md). Les descriptions
d'infrastructure ci-dessous appartiennent au cadrage B2B historique.

Aider à analyser des profils et des offres, puis à préparer des candidatures fondées sur les informations confirmées. Le code actuel livre l’espace candidat, l’import CV sourcé, la synchronisation du dossier, le suivi d’offres, la comparaison expliquée et les brouillons texte corrigibles.

## Décisions du socle

- Conserver NestJS et Express déjà présents ; ne pas migrer sans besoin mesuré.
- Utiliser npm et son lockfile ; aucun monorepo ni workspace n’existe actuellement.
- Garder une application modulaire. Isoler ultérieurement les traitements longs dans un worker si nécessaire.
- Appliquer TypeScript strict et partager la configuration HTTP avec les tests.
- Conserver les erreurs HTTP standard de NestJS tant qu’aucun contrat métier différent n’est nécessaire.

## Cible historique non retenue — 6 septembre 2026

Le porteur avait envisagé un SaaS B2B pour cabinets de recrutement. Ce segment, les organisations, les missions et la formation associée sont désormais hors projet. L’assistant candidat est devenu le produit unique.

Les cinq PDF V2.0 du dossier parent et `../../documents/README.md` décrivent le cadrage détaillé. Leurs noms historiques contenant `v1` sont conservés, mais leur contenu est en V2. Les tarifs, quotas et objectifs sont des hypothèses de pilote, pas des engagements publiés.

## Première tranche fonctionnelle B2B historique — ne pas développer

Créer une organisation, saisir une mission, importer des CV PDF textuels autorisés, corriger les profils extraits, consulter une sélection expliquée, puis préparer et exporter une synthèse ou un brouillon de message. Aucun rejet ni envoi automatique.

Critères principaux : preuves reliées aux documents, incertitudes visibles, aucune qualification inventée, isolation par cabinet, reprise sans doublon et suppression complète. Le cahier des charges V2 précise les limites et les seuils de recette.

## Ordre de développement B2B historique — ne pas suivre

1. Valider le besoin avec les cabinets et qualifier le cadre données/IA.
2. Ajouter identité, organisations, autorisations, stockage et migrations.
3. Construire import, extraction sourcée et correction.
4. Évaluer la comparaison sur corpus annoté, distinct des exemples de réglage.
5. Ajouter brouillons, export, quotas et instrumentation du coût.
6. Conduire des pilotes accompagnés avant abonnement autonome.

PostgreSQL, pgvector, BullMQ et un frontend sont proposés, pas installés. Hermes est facultatif ; aucun changement du socle exécutable n’est réalisé par la révision des PDF.

## Import de CV PDF textuel — 6 septembre 2026

Besoin : la tranche 3 de `docs/B2C.md` demande d'importer un CV textuel, de montrer les extraits sources et de permettre la correction du profil extrait, sans inventer de contenu. Réalisé dans l'API NestJS, module `src/cv-import/`.

Coût et dépendances : une seule dépendance ajoutée, `pdfjs-dist` (lecture de la couche texte, sans OCR ni service externe). Aucune base de données, aucun worker, aucun appel de modèle. Le texte analysé reste en mémoire du processus, plafonné à 200 documents, expiré au bout de `CV_IMPORT_RETENTION_SECONDS` et oublié dès la confirmation du profil. Conséquence assumée : avec plusieurs instances, l'appel de confirmation doit atteindre l'instance qui a analysé le CV ; passer à un stockage partagé seulement si ce déploiement devient réel.

Extraction déterministe par règles nommées (`nom-en-tete`, `ville-code-postal`, `section-competences`, …). Elle couvre prénom, nom, email, téléphone, intitulé, ville, contrat, compétences et présentation. Les lignes trouvées sous les sections expériences et formations/diplômes sont proposées séparément. Chaque valeur cite page, ligne et bornes ; la personne choisit puis corrige les éléments structurés. Un champ sans preuve reste vide et affiche la raison. À la confirmation, une valeur déclarée `extracted` est refusée si elle ne se retrouve pas dans le document ; une valeur assumée par la personne est marquée `manual`. Un PDF sans couche texte est refusé : pas de reconnaissance d'image, donc pas de texte deviné.

Interface : `web/src/CvImport.tsx` montre pour chaque champ les propositions et leurs lignes sources surlignées, et impose un choix explicite entre proposition sourcée, saisie manuelle et champ vide. Le frontend n'écrit jamais `extracted` sur une valeur qu'il a modifiée ; l'API refuserait la requête. `VITE_API_BASE_URL` désigne l'API NestJS et `CORS_ORIGINS` doit contenir l'origine du frontend.

Note : `jest` est lancé avec `NODE_OPTIONS=--experimental-vm-modules` via `cross-env`, car `pdfjs-dist` n'est plus distribué en CommonJS depuis la version 4 et les versions 3 portent l'avis de sécurité GHSA-wgrm-67xf-hhpq.

## Mesures avant montée en charge

Suivre pertinence des résultats, corrections nécessaires aux lettres, latence, taux d’erreur et coût par traitement. Les anciens chiffres des PDF V1 (500 000 utilisateurs, réduction de 99 %, gains ×10 à ×50) ont été remplacés dans les V2 par des scénarios et objectifs à mesurer. Évaluer un besoin réel avant microservices Rust/Go, Qdrant distribué, Kubernetes ou GPU dédiés.

Les analyses personnalisées doivent être isolées par utilisateur et version de profil ; ne pas partager de résultat personnalisé sur la seule similarité de deux profils. Les offres publiques normalisées peuvent être dédupliquées indépendamment.

### Traçabilité du profil après import

Les extraits retenus (page, ligne, texte et plage surlignée) sont conservés dans
`profileSources` du dossier candidat. Ils suivent le stockage local, la synchronisation
et les exports/restaurations JSON existants, sans infrastructure supplémentaire.
Modifier un champ le marque comme manuel et retire ses anciens extraits. Les anciens
dossiers sans métadonnées restent compatibles ; leur origine est indiquée inconnue.
Le PDF complet n’est pas conservé. Les métadonnées sont un historique éditable du
parcours, pas une attestation cryptographique du document source.
