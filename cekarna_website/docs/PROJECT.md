# Cekarna — référence projet

**Priorité actuelle : B2C.** L’utilisateur a décidé de commencer par les particuliers en recherche d’emploi. Lire `B2C.md` pour le périmètre actif. Les éléments B2B ci-dessous sont conservés comme historique différé.

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
passe livrées (transport mailer `log` en développement, SMTP à brancher avant
ouverture publique). MFA/passkeys : tranche B à spécifier. Les données du
candidat sont synchronisées avec PostgreSQL pour les comptes connectés et restent
disponibles localement comme repli.

## Objectif historique

Aider à analyser des profils et des offres, puis à préparer des candidatures fondées sur les informations confirmées. Le code actuel constitue uniquement le socle HTTP.

## Décisions du socle

- Conserver NestJS et Express déjà présents ; ne pas migrer sans besoin mesuré.
- Utiliser npm et son lockfile ; aucun monorepo ni workspace n’existe actuellement.
- Garder une application modulaire. Isoler ultérieurement les traitements longs dans un worker si nécessaire.
- Appliquer TypeScript strict et partager la configuration HTTP avec les tests.
- Conserver les erreurs HTTP standard de NestJS tant qu’aucun contrat métier différent n’est nécessaire.

## Cible retenue — 6 septembre 2026

Le porteur du projet a retenu le SaaS B2B pour cabinets de recrutement. Le segment initial proposé est celui des cabinets de 2 à 10 recruteurs spécialisés dans les métiers tech ; ce sous-segment reste à valider. L’assistant candidat, le local et la formation sont différés.

Les cinq PDF V2.0 du dossier parent et `../../documents/README.md` décrivent le cadrage détaillé. Leurs noms historiques contenant `v1` sont conservés, mais leur contenu est en V2. Les tarifs, quotas et objectifs sont des hypothèses de pilote, pas des engagements publiés.

## Première tranche fonctionnelle spécifiée

Créer une organisation, saisir une mission, importer des CV PDF textuels autorisés, corriger les profils extraits, consulter une sélection expliquée, puis préparer et exporter une synthèse ou un brouillon de message. Aucun rejet ni envoi automatique.

Critères principaux : preuves reliées aux documents, incertitudes visibles, aucune qualification inventée, isolation par cabinet, reprise sans doublon et suppression complète. Le cahier des charges V2 précise les limites et les seuils de recette.

## Ordre de développement

1. Valider le besoin avec les cabinets et qualifier le cadre données/IA.
2. Ajouter identité, organisations, autorisations, stockage et migrations.
3. Construire import, extraction sourcée et correction.
4. Évaluer la comparaison sur corpus annoté, distinct des exemples de réglage.
5. Ajouter brouillons, export, quotas et instrumentation du coût.
6. Conduire des pilotes accompagnés avant abonnement autonome.

PostgreSQL, pgvector, BullMQ et un frontend sont proposés, pas installés. Hermes est facultatif ; aucun changement du socle exécutable n’est réalisé par la révision des PDF.

## Mesures avant montée en charge

Suivre pertinence des résultats, corrections nécessaires aux lettres, latence, taux d’erreur et coût par traitement. Les anciens chiffres des PDF V1 (500 000 utilisateurs, réduction de 99 %, gains ×10 à ×50) ont été remplacés dans les V2 par des scénarios et objectifs à mesurer. Évaluer un besoin réel avant microservices Rust/Go, Qdrant distribué, Kubernetes ou GPU dédiés.

Les analyses personnalisées doivent être isolées par utilisateur et version de profil ; ne pas partager de résultat personnalisé sur la seule similarité de deux profils. Les offres publiques normalisées peuvent être dédupliquées indépendamment.
