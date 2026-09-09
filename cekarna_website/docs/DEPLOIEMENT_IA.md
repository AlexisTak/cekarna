# Déploiement du service IA

Les utilisateurs accèdent aux outils IA depuis le site Cekarna. Ils n’installent
ni Hermes ni Ollama. Le navigateur envoie une requête authentifiée à l’API
NestJS ; seule cette API contacte le moteur d’inférence.

```text
Navigateur HTTPS -> API NestJS -> réseau privé -> Ollama/Hermes
                         |
                         +-> service Rust d'offres
```

## Configuration

En développement, `HERMES_BASE_URL=http://127.0.0.1:11434` utilise Ollama sur le
poste du développeur. En production, cette variable désigne l’origine interne du
service central. `HERMES_MODEL` sélectionne le modèle et `HERMES_API_KEY` ajoute
un en-tête `Authorization: Bearer …` aux appels de génération et de disponibilité.

Ces trois valeurs appartiennent au backend. Elles ne doivent jamais être placées
dans le build Vite, exposées sous un nom `VITE_*`, enregistrées dans Git ou
retournées par une route de diagnostic. La clé doit venir du gestionnaire de
secrets de l’hébergeur. Le service d’inférence doit être inaccessible depuis
Internet ou protégé par le réseau privé, TLS et une authentification adaptée.

Les anciennes variables `LOCAL_LLM_BASE_URL` et `LOCAL_LLM_MODEL` sont encore
lues si les nouvelles sont absentes afin de préserver les environnements locaux
existants. Elles ne constituent plus le contrat de déploiement.

## Données et charge

NestJS transmet un profil professionnel compact, jamais le PDF brut, les
coordonnées ou les notes privées. Le service Rust examine au plus 500 offres et
n’en remet que six à Hermes. NestJS regroupe l’analyse, limite les appels
simultanés, déduplique les requêtes identiques et garde un cache court en mémoire.
Les réponses ne sont conservées que si leurs preuves existent littéralement dans
les données transmises.

Ce mécanisme rend les outils utilisables depuis le site pour les personnes
connectées. Pour plusieurs réplicas NestJS ou pour analyser des comptes hors
connexion, il faudra remplacer la limitation et le cache en mémoire par une file
durable et un état partagé. Cette étape dépend de l’hébergement retenu et reste
dans la recette de production C12.

## Contrôles avant ouverture

- Déployer Hermes/Ollama dans le même réseau privé que l’API.
- Charger le modèle indiqué par `HERMES_MODEL`.
- Créer la clé serveur et l’injecter dans les secrets des deux services.
- Vérifier que `/health/ready` voit Hermes sans révéler l’URL ni la clé.
- Bloquer tout accès direct du navigateur au port d’inférence.
- Mesurer latence, mémoire, files d’attente et coût sur un corpus autorisé.
- Définir les alertes, responsables d’incident et limites de débit distribuées.
