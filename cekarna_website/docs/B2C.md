# Cekarna B2C — périmètre actif

Le 6 septembre 2026, après le cadrage B2B, l’utilisateur a décidé de commencer par une **application web pour les particuliers en recherche d’emploi**. Cette décision devient prioritaire. Les PDF V2 B2B sont conservés sans réécriture.

## Première tranche livrée

- Tableau de bord avec compteurs calculés depuis les offres enregistrées.
- Mode découverte identifié, avec profil et entreprises fictifs ; création d’un espace vide sur demande.
- Profil manuel : prénom, poste, ville, contrat, compétences et parcours.
- Ajout/modification/suppression manuelle d’offres et liens HTTP(S).
- Recherche dans les offres, filtres par statut et détail.
- Suivi : à préparer, envoyée, entretien et terminée ; notes modifiables.
- Repères explicables par comparaison textuelle de ville, contrat et compétences. Ils ne constituent pas une évaluation IA.
- Sauvegarde dans le navigateur, export/restauration JSON validé, effacement après confirmation.
- Navigation adaptée au mobile et formulaires utilisables au clavier.
- Page d’accueil publique : parcours expliqué, accès à l’espace candidat, réponses aux limites de la version et rappel du stockage local.

## Architecture actuelle

Le frontend React/TypeScript est dans `web/`, construit par Vite. Il utilise son propre package npm et lockfile, sans transformer le backend en monorepo. L’API NestJS existante reste intacte. Aucun profil ou offre ne transite par cette API pour l’instant.

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
3. Importer un CV textuel, montrer les extraits sources et permettre la correction du profil extrait.
4. Ajouter collecte d’offres depuis des sources autorisées et une comparaison évaluée sur corpus.
5. Préparer des brouillons personnalisés, sans inventer d’expériences ; validation et export avant tout envoi.

L’import de CV, la recherche automatique, les notifications et les modèles IA ne sont pas simulés dans cette première tranche. Aucun abonnement ni envoi de candidature n’est activé.

## Vérification

`npm run check:web` depuis `cekarna_website` exécute les tests des règles locales et le build TypeScript/Vite. `npm run check:all` inclut aussi les contrôles NestJS. Vérifier en navigateur ajout, statut, notes, réouverture et affichage mobile avant chaque livraison qui change ces parcours.
