# Mémoire du projet Cekarna

## Coordination du travail restant

Lire `cekarna_website/docs/ROADMAP.md` avant de choisir une tâche. Cette feuille tenue par Codex recense les priorités, critères de livraison et validations restantes. Mettre à jour la tâche concernée et son journal après intervention ; vérifier l’état Git avant d’éditer.

À la demande de l’utilisateur, conserver les cinq PDF comme références durables du projet. Le cahier des charges est désormais une référence B2C active ; les quatre autres PDF restent historiques. Ce fichier sert de repère aux prochaines sessions ; consulter les documents ou leurs sources avant de prendre une décision détaillée.

## Priorité actuelle — décision ultérieure du 6 septembre 2026

L’utilisateur a décidé que Cekarna est **exclusivement une application web pour les particuliers en recherche d’emploi (B2C)**. Le produit B2B pour cabinets de recrutement ne fait plus partie du projet.

- Référence actuelle : `cekarna_website/docs/B2C.md`.
- Interface : `cekarna_website/web/`, React + Vite + TypeScript, npm. La racine est la page d’accueil publique ; `?workspace=candidate` ouvre l’espace candidat sans exiger de règle de réécriture serveur.
- Socle B2C : profil manuel, offres ajoutées manuellement, filtres, suivi de candidature, notes, export/restauration JSON. État local conservé dans le navigateur ; mode découverte explicitement fictif. L’import de CV PDF textuel, avec extraits visibles et correction, est également livré ; aucune valeur ne doit être inventée.
- Le compte connecté, la vérification d’adresse, la récupération, la synchronisation du dossier candidat, les passkeys facultatives et les recommandations d’offres par Hermes sont livrés. L’envoi automatique de candidatures ne l’est pas. Ne pas présenter une comparaison ou une recommandation comme une probabilité d’embauche.
- Backend NestJS conservé. Le microservice Go/Chi est dans `cekarna_website/services/auth/` : PostgreSQL, Redis, Argon2id, JWT Ed25519 de 5 min, JWKS, refresh opaques avec rotation, audit et passkeys WebAuthn. Lire son README avant modification. Le microservice Rust `cekarna_website/services/notifications/` gère la file SMTP transactionnelle durable. Ces services répondent aux demandes explicites de l’utilisateur malgré le report historique ci-dessous.
- Le cahier des charges V3 décrit le B2C actif. Les quatre PDF V2 restants sont des références historiques de principes utiles (preuves, correction humaine, fiabilité), pas un périmètre à implémenter.

## Décisions B2B antérieures — historique non retenu

- Cible envisagée : SaaS B2B pour cabinets de recrutement.
- Ce périmètre (organisations, missions, viviers, facturation cabinet et formation associée) est abandonné. Ne pas le développer ni le proposer à nouveau sans instruction explicite de l’utilisateur.
- Les principes non spécifiques au B2B restent utiles : décision humaine, aucune information inventée, sécurité des données et validation par des mesures.

## Références V2.0

Les chemins ci-dessous sont relatifs à la racine de ce projet. Le cahier des charges courant est en **V3.0 B2C**. Malgré certains noms contenant `v1`, les quatre autres PDF restent en **V2.0 historique**.

1. `cahier_des_charges_cekarna.pdf` — périmètre, exigences et recette (4 pages).
2. `optimisation_cekarna_v1.pdf` — charge, coûts et fiabilité (4 pages).
3. `plan_b2b_saas_v1.pdf` — offre, quotas et pilotes (5 pages).
4. `plan_formation_ia_v1.pdf` — offre pédagogique future (3 pages).
5. `stack_microservices_rust_v1.pdf` — architecture progressive (4 pages).

Dossier assemblé : `documents/dossier_cekarna_v2.pdf` (20 pages).

## Accès au contenu et mises à jour

- Guide : `documents/README.md`.
- Source éditoriale complète : `documents/sources/author_content.py`.
- Texte structuré généré : `documents/sources/cekarna_v2.json` ; pratique pour relire les PDF sans extraction.
- Génération : `documents/sources/build_pdfs.py`.
- Originaux V1 : `documents/archives/originaux_20260906_013919/` ; les préserver.
- État et cadrage du code : `cekarna_website/README.md` et `cekarna_website/docs/PROJECT.md`.

Les instructions ultérieures de l’utilisateur priment sur cette mémoire. Répercuter les changements de stratégie dans les références concernées. Ne pas confondre les exigences documentées avec des fonctionnalités implémentées. Revalider les sources réglementaires et techniques évolutives avant une décision de lancement.
