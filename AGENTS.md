# Mémoire du projet Cekarna

À la demande de l’utilisateur, conserver les cinq PDF comme références durables du projet. Ce fichier sert de repère aux prochaines sessions ; consulter les documents ou leurs sources avant de prendre une décision détaillée.

## Priorité actuelle — décision ultérieure du 6 septembre 2026

L’utilisateur a décidé de **commencer par l’application web pour les particuliers en recherche d’emploi (B2C)**. Cette décision remplace la priorité B2B ci-dessous. Le B2B est différé.

- Référence actuelle : `cekarna_website/docs/B2C.md`.
- Interface : `cekarna_website/web/`, React + Vite + TypeScript, npm. La racine est la page d’accueil publique ; `?workspace=candidate` ouvre l’espace candidat sans exiger de règle de réécriture serveur.
- Socle B2C : profil manuel, offres ajoutées manuellement, filtres, suivi de candidature, notes, export/restauration JSON. État local conservé dans le navigateur ; mode découverte explicitement fictif. L’import de CV PDF textuel, avec extraits visibles et correction, est également livré ; aucune valeur ne doit être inventée.
- Le compte connecté, la vérification d’adresse, la récupération et la synchronisation du dossier candidat sont livrés. La recherche automatique, l’envoi de candidatures et la génération IA ne sont pas livrés. Ne pas présenter les repères textuels comme un score IA.
- Backend NestJS conservé. Le microservice Go/Chi est dans `cekarna_website/services/auth/` : PostgreSQL, Redis, Argon2id, JWT Ed25519 de 5 min, JWKS, refresh opaques avec rotation et audit. Lire son README avant modification. Le microservice Rust `cekarna_website/services/notifications/` gère la file SMTP transactionnelle durable. MFA/passkeys restent à construire. Ces demandes explicites autorisent ces services malgré le report historique ci-dessous.
- Les PDF V2 restent conservés comme cadrage B2B historique, **pas comme cahier des charges prioritaire du B2C**. Ne pas les réécrire sans demande ou besoin explicite.

## Décisions B2B antérieures — historique du 6 septembre 2026

- Cible explicitement choisie : **SaaS B2B pour cabinets de recrutement**.
- MVP spécifié : organisation, mission, import de CV PDF textuels autorisés, correction du profil, sélection expliquée, synthèse ou brouillon éditable et export.
- Décision humaine ; pas de rejet ni d’envoi automatique. Viviers privés et isolés par cabinet.
- Conserver le socle NestJS/Express et une architecture progressive. Le frontend, la base, les workers et les fonctions IA restent à construire selon l’état constaté à cette date ; vérifier le code pour connaître l’état actuel.
- Formation, assistant candidat et application locale différés. Rust/Go et infrastructure distribuée conditionnés à des mesures.
- Segment tech, tarifs, quotas, coûts et performances : hypothèses ou objectifs à valider, pas résultats acquis ni engagements clients.

## Références V2.0

Les chemins ci-dessous sont relatifs à la racine de ce projet. Malgré certains noms contenant `v1`, les cinq PDF courants ont été réécrits en **V2.0**.

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
