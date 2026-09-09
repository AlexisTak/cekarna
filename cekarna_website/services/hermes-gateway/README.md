# Passerelle Hermes

Ce microservice Rust protège l’instance Ollama/Hermes centrale. NestJS est son
seul client. Il expose uniquement `GET /api/tags` et `POST /api/chat`, exige un
jeton Bearer comparé en temps constant, impose le modèle configuré, refuse les
corps inattendus et limite les générations simultanées.

Ollama ne doit pas être publié sur Internet. Placez cette passerelle et Ollama
sur le même réseau privé. Exposez la passerelle uniquement à l’API NestJS et
utilisez la même valeur secrète pour `HERMES_GATEWAY_TOKEN` ici et
`HERMES_API_KEY` dans NestJS. Configurez alors :

```text
HERMES_BASE_URL=http://hermes-gateway:8084
HERMES_MODEL=hermes3:3b
HERMES_API_KEY=<secret partagé>
```

Pour le développement :

```sh
cp .env.example .env
cargo run
```

La passerelle attend Ollama sur `http://127.0.0.1:11434` par défaut. Le secret
d’exemple doit être remplacé et `.env` ne doit pas être ajouté à Git.
Dans un conteneur, définir `HERMES_GATEWAY_ADDR=0.0.0.0:8084` et utiliser le nom
DNS privé du conteneur Ollama dans `OLLAMA_BASE_URL`.

Contrôles :

```sh
cargo fmt --check
cargo test
cargo clippy --all-targets -- -D warnings
```

`GET /health/live` vérifie le processus. `GET /health/ready` vérifie que
l’endpoint des modèles d’Ollama répond, sans renvoyer sa configuration. La
passerelle ne stocke ni profil, ni offre, ni réponse du modèle.
