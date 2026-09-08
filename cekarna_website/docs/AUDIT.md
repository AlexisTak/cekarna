# Audit de cohérence — 6 septembre 2026



Références : périmètre B2C, README des services et source structurée des cinq

PDF (`../../documents/sources/cekarna_v2.json`). Le cahier V3 documente le B2C actif ; les quatre autres PDF V2 documentent un B2B

abandonné ; leurs exigences de preuves, d'isolation et de décision humaine

s'appliquent comme principes au parcours B2C. Aucun PDF historique n'est modifié.



## Corrections effectuées



- Une réponse d'échec à la déconnexion est maintenant présentée comme une erreur.

- Une suppression de compte refusée conserve le jeton de session pour réessayer.

- Les nouvelles copies locales des dossiers connectés utilisent une clé par compte.

  Le dossier serveur reste affiché même si le stockage navigateur refuse l'écriture.

  La synchronisation est suspendue tant que le chargement serveur a échoué.

- Un champ de CV déclaré extrait doit correspondre exactement à une proposition

  calculée depuis le document ou à un fragment littéral d'une ligne. Les listes

  proposées de compétences gardent leurs extraits ; une recomposition arbitraire

  doit être déclarée manuelle.

- Le message d'inscription distingue demande d'envoi et réception effective.

- L'image Rust inclut les migrations et utilise la même distribution que son

  environnement d'exécution. Le contexte Docker exclut les secrets locaux.

- Les reprises SMTP sont bornées et les dernières tentatives interrompues passent

  en échec. Les réponses brutes SMTP ne sont plus conservées dans `last_error`.



- Les extraits confirmés et leur origine sont conservés avec le profil, affichés

  dans son formulaire, synchronisés et inclus dans les exports JSON. Une modification

  manuelle retire les extraits du champ concerné. Les anciens profils restent lisibles

  avec une origine inconnue ; les exports restaurés ne sont pas des preuves signées.



## Limites encore ouvertes



- Notifications : l’outbox, l’idempotence, l’expiration et la purge interservices

  sont livrées. La configuration d’un fournisseur réel, la validation d’une réception

  externe, les règles de rétention et le suivi des rebonds restent à réaliser.

- Les caches navigateur historiques sous la clé commune ne sont pas effacés

  automatiquement afin de préserver le travail local. Les caches par compte ne

  constituent pas un chiffrement du stockage sur un appareil partagé.

- Les analyses PDF sont en mémoire, rattachées à l’identifiant du compte contrôlé

  auprès du service d’identité ; elles ne sont pas partageables entre instances.

  Un déploiement multi-instance nécessitera un stockage temporaire partagé ou une

  affinité de session.



- La comparaison et les recommandations Hermes restent textuelles, sans mesure de performance représentative ni score de probabilité.

- Les passkeys facultatives et les brouillons sont livrés. Facturation et automatisations de candidature ne le sont pas.

- Collecte d'offres : le service Rust et la façade NestJS sont livrés, mais France

  Travail reste désactivé tant que ses identifiants et conditions ne sont pas validés.



Ce relevé porte sur le dépôt local. Il ne certifie pas un déploiement de production

ni la conformité réglementaire du produit.

