# Cekarna — application candidats et API

Priorité actuelle : application web pour les particuliers en recherche d’emploi. Le B2B est abandonné ; les PDF V2 du dossier parent sont conservés comme archives historiques.

## Application web B2C

La racine du site est une page d’accueil publique qui présente les fonctions réellement disponibles. L’espace candidat contient un tableau de bord, un profil manuel, des offres, des filtres, un suivi des candidatures et des notes. Le mode découverte contient uniquement des exemples fictifs. Sans compte, les données sont sauvegardées dans le navigateur. Avec un compte, elles sont aussi conservées dans PostgreSQL via le service Go ; export et restauration JSON restent disponibles.

Prérequis du frontend : Node.js 22.12+ (ou Node.js 24), npm. Depuis `cekarna_website` :

```sh
npm ci --prefix web
npm run dev:web
```

Ouvrir http://127.0.0.1:5173 pour la page d’accueil, puis utiliser http://127.0.0.1:5173/?workspace=candidate pour l’espace candidat. Vérifier avec `npm run check:web`. Voir `web/README.md` et `docs/B2C.md`.

## API NestJS conservée

## État réel

Le dépôt contient une API NestJS 11 avec Express et TypeScript strict, un frontend React/Vite B2C, un service Go/Chi d’identité et de stockage candidat utilisant PostgreSQL et Redis, ainsi qu’un service Rust de notifications transactionnelles avec PostgreSQL et SMTP. La comparaison optionnelle peut appeler un modèle Ollama local. Le brouillon de candidature est construit localement avec les informations confirmées, reste modifiable et n’est jamais envoyé par Cekarna. Les PDF V2 du dossier parent décrivent l’ancien projet B2B abandonné. Le cadrage prioritaire actuel est `docs/B2C.md`.

- `GET /` : identité de l’API et état `initialization`.
- `GET /health` : disponibilité du processus HTTP (`{"status":"ok"}`). Ce contrôle ne vérifie aucune dépendance externe.
- `POST /v1/cv-import/extraction` : import authentifié d’un CV PDF **textuel** (multipart, champ `file`). Renvoie le texte page par page, des propositions de profil et, pour chacune, les extraits sources (page, ligne, bornes). Rien n’est enregistré. Un PDF scanné est refusé en 422 : aucune reconnaissance d’image, aucune valeur devinée.
- `POST /v1/cv-import/profile` : validation authentifiée du profil après correction manuelle. Chaque champ porte `source` : `extracted` (vérifié caractère pour caractère contre le CV importé) ou `manual` (saisie assumée). Une valeur annoncée comme extraite mais absente du document est refusée en 400.
- `POST /v1/local-ai/compare` : comparaison sur demande, réservée à une session active, via Ollama local. Les preuves sans extrait littéral sont écartées et le résultat n’est pas un score d’embauche.
- `GET /v1/offers` : offres publiques collectées et dédupliquées par `services/offers`, avec filtres et pagination.
- `GET /v1/offers/:id` : offre, chemins d'origine, membres du groupe de doublons et décisions de regroupement.
- Validation globale des futurs DTO avec `class-validator` : champs inconnus refusés, sans conversion implicite des valeurs.
- En-têtes HTTP Helmet, CORS limité aux origines configurées, arrêt sur signaux système.

## Installation et démarrage

Prérequis : Node.js 22 ou supérieur et npm. Exécuter les commandes depuis `cekarna_website`.

```sh
npm ci
```

Copier `.env.example` vers `.env` et ajuster si nécessaire. Les variables de l’environnement prennent priorité sur `.env`.

```sh
npm run start:dev
```

L’API écoute par défaut sur http://127.0.0.1:3000. Aucun service Docker n’est nécessaire.

| Variable | Défaut | Usage |
| --- | --- | --- |
| `PORT` | `3000` | Entier de 1 à 65535 |
| `HOST` | `127.0.0.1` | Adresse d’écoute ; `0.0.0.0` pour un conteneur |
| `CORS_ORIGINS` | vide | Origines HTTP(S) exactes, séparées par des virgules, sans chemin ni slash final |
| `CV_IMPORT_MAX_BYTES` | `5000000` | Taille maximale d’un CV importé, de 1024 à 10000000 octets |
| `CV_IMPORT_RETENTION_SECONDS` | `900` | Durée de conservation en mémoire du texte extrait, de 60 à 3600 secondes |
| `CV_IMPORT_MAX_PAGES` | `10` | Nombre maximal de pages d’un PDF, de 1 à 50 |
| `AUTH_IDENTITY_URL` | `http://127.0.0.1:8081/v1/auth/me` | Endpoint HTTP(S) interne utilisé pour vérifier la session des routes privées |
| `OFFERS_BASE_URL` | `http://127.0.0.1:8083` | Origine interne du service Rust d'offres |
| `OFFERS_INTERNAL_TOKEN` | vide | Secret partagé ; vide désactive la lecture des offres collectées |

L'écran d'import du frontend appelle cette API depuis le navigateur : en développement, renseigner `CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173` pour couvrir les deux adresses locales. En production, n’autoriser que l’origine HTTPS réelle. Côté frontend, `VITE_API_BASE_URL` pointe l'API NestJS (défaut `http://127.0.0.1:3000`).

La comparaison assistée peut appeler un modèle Ollama local avec `LOCAL_LLM_BASE_URL` et `LOCAL_LLM_MODEL` (par défaut `hermes3:3b`). Elle exige une session, ne contacte aucun fournisseur externe et écarte les preuves qui ne sont pas des extraits littéraux du profil ou de l’offre.

CORS contrôle les autorisations des navigateurs ; il ne remplace pas une authentification. Pour les futures routes recevant des données, déclarer des classes DTO avec des décorateurs de validation ; une interface TypeScript seule ne valide pas les entrées HTTP.

## Vérifications

```sh
npm run check
```

Cette commande enchaîne lint sans modification, vérification TypeScript, tests unitaires, tests HTTP, tests du frontend et compilation. Elle peut servir de contrôle CI après installation des dépendances des deux dossiers.

- `npm run lint:fix` : corrections automatiques explicites.
- `npm run format` : formatage des sources et tests.
- `npm run test:cov` : couverture des tests unitaires.
- `npm run build` puis `npm run start:prod` : exécution du code compilé.

La configuration commune est appliquée en production et dans les tests HTTP. Les erreurs HTTP utilisent le traitement standard de NestJS. Les erreurs de configuration interrompent le démarrage ; elles sont journalisées avec un code de sortie non nul.

## Organisation

- `src/main.ts` : chargement de l’environnement et démarrage.
- `src/config/environment.ts` : lecture et validation de la configuration.
- `src/configure-app.ts` : configuration HTTP commune.
- `src/app.*` : module racine et endpoints d’identification/santé.
- `src/cv-import/` : import de CV PDF textuel, extraction sourcée et validation du profil corrigé. Le texte analysé reste en mémoire, expire au délai configuré et est oublié dès la confirmation ; il n’est écrit ni sur disque ni en base.
- `test/` : tests HTTP, dont un contrôleur de validation présent uniquement dans les tests.
- `docs/PROJECT.md` : périmètre, décisions techniques et prochaines étapes.

Les fonctions livrées et les tâches restantes sont suivies dans `docs/ROADMAP.md`. Ne pas stocker de vrais CV, de données personnelles ou de secrets dans le dépôt.
