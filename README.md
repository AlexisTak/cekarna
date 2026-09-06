# Cekarna

Cekarna est une application web B2C pour accompagner les particuliers dans leur recherche d’emploi : profil, offres sauvegardées, suivi des candidatures et notes.

Le code exécutable se trouve dans [`cekarna_website/`](cekarna_website/README.md) :

- `web/` : interface React, Vite et TypeScript ;
- `services/auth/` : identité et stockage candidat avec Go, Chi, PostgreSQL et Redis ;
- `src/` : API NestJS conservée pour les futurs domaines métier.

Le cadrage actif est documenté dans [`cekarna_website/docs/B2C.md`](cekarna_website/docs/B2C.md). Le dossier [`documents/`](documents/README.md) conserve les références historiques et leurs sources.

## Vérification

Depuis `cekarna_website/` :

```sh
npm ci
npm ci --prefix web
npm run check:all
```

Le service d’authentification possède ses propres instructions et tests d’intégration dans [`cekarna_website/services/auth/README.md`](cekarna_website/services/auth/README.md).
