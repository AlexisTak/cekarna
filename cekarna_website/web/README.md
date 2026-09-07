# Cekarna — espace candidats

Première version web B2C : profil, offres manuelles et suivi des candidatures. Le démarrage affiche un exemple clairement identifié ; « Créer mon espace » ouvre un espace vide après confirmation.

## Démarrer

Node.js 22.12+ ou 24, puis depuis ce dossier :

```sh
npm ci
npm run dev
```

Adresse : http://localhost:5173. La page d’accueil publique est disponible à la racine. Les formulaires `/inscription` et `/connexion` utilisent le service Go d’authentification local sur `http://localhost:8081`. L’espace candidat reste accessible avec `?workspace=candidate`. Les vues de l’espace utilisent des fragments d’URL.

```sh
npm test
npm run build
```

Le build produit `dist/`. Le site statique est configuré pour un déploiement Sites avec reprise des routes côté client. L’API NestJS du dossier parent est nécessaire pour l’import de CV et la comparaison Ollama locale ; le reste de l’espace candidat reste utilisable sans elle.

## Données et limites

- Clé de stockage : `cekarna.candidats.v1`, schéma version 1.
- Sans compte, profil, offres et notes restent dans le stockage du navigateur. Avec un compte connecté, le dossier est chargé et enregistré dans PostgreSQL via le service d’identité ; la première reprise d’un espace local demande une confirmation explicite.
- Export JSON et restauration depuis « Mon profil ». Le fichier contient vos informations : conservez-le dans un emplacement approprié.
- 1 000 offres maximum et import de sauvegarde limité à 5 Mo ; le quota réel dépend aussi du navigateur. Une sauvegarde impossible affiche une alerte.
- Les liens externes n’acceptent que HTTP(S), sans identifiants intégrés.
- Les repères de correspondance sont des comparaisons de texte, pas un classement IA.
- L’import de CV PDF textuel nécessite une session active et l’API NestJS. La comparaison Ollama locale est proposée à la demande depuis une offre, sans score d’embauche.
- Aucun scraping, brouillon généré ni envoi automatique.

## Sources

- `src/domain.ts` : schéma, validation, exemples, correspondances et export.
- `src/domain.test.ts` : validation des sauvegardes et règles de comparaison.
- `src/App.tsx` : vues, formulaires et interactions.
- `src/Auth.tsx` : formulaires d’inscription et de connexion raccordés au service d’identité.
- `src/style.css` : thème, composants et adaptation mobile.

Police DM Sans livrée localement par npm ; aucune requête Google Fonts. Les exemples ne renvoient pas vers de vraies offres.
