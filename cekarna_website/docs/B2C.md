# Cekarna B2C — périmètre actif

Le 7 septembre 2026, l’utilisateur a décidé que Cekarna serait une **application web exclusivement destinée aux particuliers en recherche d’emploi**. Les fonctionnalités pour cabinets, organisations et recruteurs ne font pas partie du projet. Le cahier des charges V3 reflète désormais cette décision ; les quatre autres PDF V2 restent des archives de principes utiles.

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
- Passkeys facultatives : plusieurs appareils nommés, second facteur après le mot de passe, révocation unitaire et récupération par réinitialisation du mot de passe.
- Navigation adaptée au mobile et formulaires utilisables au clavier.
- Page d’accueil publique : parcours expliqué, accès à l’espace candidat, réponses aux limites de la version et rappel du stockage local.

## Architecture actuelle

Le frontend React/TypeScript est dans `web/`, construit par Vite. Il utilise son propre package npm et lockfile, sans transformer le backend en monorepo. L’API NestJS reçoit les imports CV authentifiés et la comparaison locale optionnelle ; les profils, offres et notes confirmés sont enregistrés dans le dossier privé du service Go.

La racine de l’application web est la page d’accueil publique. L’espace candidat est ouvert avec `?workspace=candidate` afin de rester utilisable sur un hébergement statique sans configuration serveur. L’ancienne URL locale `/app` reste reconnue à des fins de compatibilité.

Les données locales ne sont ni synchronisées ni protégées par un compte. La démonstration ne doit pas être présentée comme un service SaaS de production. Le chargement des données valide le schéma versionné et les liens ; en cas d’échec de stockage, un avertissement permet d’exporter le travail.

## État des services et suite

L’identité et le stockage privé du dossier candidat sont livrés dans `services/auth/` : Go/Chi, PostgreSQL, Redis, JWT Ed25519, sessions rotatives et passkeys WebAuthn. Les formulaires publics `/inscription` et `/connexion` sont raccordés. Le frontend charge et sauvegarde le profil, les offres et les notes du compte ; l’import d’un espace local existant demande une confirmation explicite.

L’import de CV PDF textuel est livré dans `src/cv-import/` avec relecture dans `web/src/CvImport.tsx`. Un centre de notifications local conserve les messages importants et les rappels choisis. Le service Rust d’offres collecte et déduplique les sources autorisées. La comparaison et les recommandations sur demande utilisent Ollama/Hermes après connexion, avec données professionnelles compactes et preuves littérales. L’ajout d’une offre publique au suivi privé exige toujours une action explicite.

Avant lancement, il reste à configurer France Travail et un fournisseur email réels, préparer l’hébergement HTTPS, les secrets, sauvegardes et alertes, puis exécuter la recette C12 sur des données fictives ou autorisées. L’abonnement et l’envoi de candidature restent désactivés.

## Vérification

`npm run check:web` depuis `cekarna_website` exécute les tests des règles locales et le build TypeScript/Vite. `npm run check:all` inclut aussi les contrôles NestJS. Vérifier en navigateur ajout, statut, notes, réouverture et affichage mobile avant chaque livraison qui change ces parcours.
