# Audit de cohérence — 6 septembre 2026



Références : périmètre B2C, README des services et source structurée des cinq

PDF (`../../documents/sources/cekarna_v2.json`). Les PDF V2 documentent un B2B

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



- Notifications : configuration du fournisseur et validation d'une réception réelle,

  idempotence, expiration des messages, rétention et suppression des données de la

  file lors d'une suppression de compte. Aucun accusé de réception ni suivi des

  rebonds n'est implémenté. Ne pas annoncer une suppression interservices complète.

- Les caches navigateur historiques sous la clé commune ne sont pas effacés

  automatiquement afin de préserver le travail local. Les caches par compte ne

  constituent pas un chiffrement du stockage sur un appareil partagé.

- Les analyses PDF sont en mémoire, accessibles par identifiant opaque ; pas

  encore d'autorisation liée au compte ni de stockage partagé entre instances.



- La comparaison reste textuelle, sans corpus d'évaluation ni score IA.

- Passkeys/MFA, facturation, brouillons IA et automatisations ne sont pas livrés.

- Collecte d'offres : un plan de développement non suivi est présent ; sa présence

  ne prouve pas une fonctionnalité exécutée.



Ce relevé porte sur le dépôt local. Il ne certifie pas un déploiement de production

ni la conformité réglementaire du produit.

