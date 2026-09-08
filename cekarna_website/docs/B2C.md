# Cekarna B2C — périmètre actif

Le 7 septembre 2026, l’utilisateur a décidé que Cekarna serait une **application web exclusivement destinée aux particuliers en recherche d’emploi**. Les fonctionnalités pour cabinets, organisations et recruteurs ne font pas partie du projet. Les PDF V2 B2B sont conservés sans réécriture comme archives de principes utiles.

## Première tranche livrée

- Tableau de bord avec compteurs calculés depuis les offres enregistrées.
- Mode découverte identifié, avec profil et entreprises fictifs ; création d’un espace vide sur demande.
- Profil manuel : prénom, nom, coordonnées, poste, ville, contrat, compétences, parcours, expériences et formations structurées.
- Ajout/modification/suppression manuelle d’offres et liens HTTP(S).
- Recherche dans les offres, filtres par statut et détail.
- Suivi : à préparer, envoyée, entretien et terminée ; notes modifiables.
- Repères explicables par comparaison textuelle de ville, contrat et compétences. Ils ne constituent pas une évaluation IA.
- Sauvegarde dans le navigateur, export/restauration JSON validé, effacement après confirmation.
- Synchronisation du dossier avec un compte connecté, conflits explicitement signalés et résolus par choix de l’utilisateur.
- Création atomique d’un profil personnel vide pour chaque nouveau compte, initialisé avec le prénom saisi et complétable dans « Mon profil ».
- Page compte : déconnexion, révocation de tous les appareils et suppression définitive des données après confirmation par mot de passe.
- Navigation adaptée au mobile et formulaires utilisables au clavier.
- Page d’accueil publique : parcours expliqué, accès à l’espace candidat, réponses aux limites de la version et rappel du stockage local.

## Architecture actuelle

Le frontend React/TypeScript est dans `web/`, construit par Vite. Il utilise son propre package npm et lockfile, sans transformer le backend en monorepo. L’API NestJS reçoit les imports CV authentifiés et la comparaison locale optionnelle ; les profils, offres et notes confirmés sont enregistrés dans le dossier privé du service Go.

La racine de l’application web est la page d’accueil publique. L’espace candidat est ouvert avec `?workspace=candidate` afin de rester utilisable sur un hébergement statique sans configuration serveur. L’ancienne URL locale `/app` reste reconnue à des fins de compatibilité.

Les données locales ne sont ni synchronisées ni protégées par un compte. La démonstration ne doit pas être présentée comme un service SaaS de production. Le chargement des données valide le schéma versionné et les liens ; en cas d’échec de stockage, un avertissement permet d’exporter le travail.

## Prochaines tranches proposées

L’identité et le stockage privé du dossier candidat sont désormais développés dans `services/auth/` à la demande de
l’utilisateur : Go/Chi, PostgreSQL, Redis, JWT Ed25519 et sessions rotatives.
Voir le README du service pour l’API et les limites. Les formulaires publics
`/inscription` et `/connexion` sont raccordés. Le frontend charge et sauvegarde le
profil, les offres et les notes du compte ; l’import d’un espace local existant
demande une confirmation explicite.

1. Valider le parcours et le vocabulaire avec le porteur du projet.
2. Ajouter identité, stockage serveur privé et autorisations par utilisateur, puis migration explicite des données locales.
3. Importer un CV textuel, montrer les extraits sources et permettre la correction du profil extrait. Côté API : livré dans `src/cv-import/` (`POST /v1/cv-import/extraction` puis `POST /v1/cv-import/profile`). Côté frontend : écran de relecture dans `web/src/CvImport.tsx`, accessible depuis « Mon profil », avec extraits sourcés, choix par champ (proposition, saisie manuelle ou vide) et enregistrement dans l'espace candidat via le flux existant.
4. Ajouter collecte d’offres depuis des sources autorisées et une comparaison évaluée sur corpus.
5. Préparer des brouillons personnalisés, sans inventer d’expériences ; validation et export avant tout envoi.

L’import de CV PDF textuel est livré. Un centre de notifications local conserve les messages importants et les rappels d’offres explicitement choisis ; son historique est isolé par compte sur l’appareil et il ne déclenche aucun e-mail. Les rappels sont évalués lorsque l’application est ouverte. La comparaison optionnelle par Ollama local est disponible après connexion. Un service Rust collecte et déduplique les offres de sources explicitement autorisées ; France Travail reste désactivé sans identifiants. L'ajout d'une offre publique au suivi privé exige une action explicite. L’abonnement et l’envoi de candidature ne sont pas activés.

## Vérification

`npm run check:web` depuis `cekarna_website` exécute les tests des règles locales et le build TypeScript/Vite. `npm run check:all` inclut aussi les contrôles NestJS. Vérifier en navigateur ajout, statut, notes, réouverture et affichage mobile avant chaque livraison qui change ces parcours.
