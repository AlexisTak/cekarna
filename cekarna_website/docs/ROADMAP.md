# Cekarna — travail restant et coordination

État de référence : 6 septembre 2026. Document de travail partagé, à actualiser après chaque livraison.

## Périmètre et références

Le périmètre décidé par l’utilisateur est le **B2C exclusivement : application web pour particuliers en recherche d’emploi**. Les cinq PDF V2 décrivent un produit B2B et une formation qui ne seront pas développés. Ils restent conservés comme archives ; seuls leurs principes de preuves, de correction humaine, d’isolation et de fiabilité guident le B2C. Les demandes ultérieures de l’utilisateur priment.

- [Périmètre B2C](B2C.md), [référence projet](PROJECT.md), [audit](AUDIT.md).
- [Guide des PDF](../../documents/README.md) et [contenu structuré des cinq PDF](../../documents/sources/cekarna_v2.json).
- [Cahier des charges](../../cahier_des_charges_cekarna.pdf) : parcours, données, preuves et recette.
- [Optimisation](../../optimisation_cekarna_v1.pdf) : mesures, coûts et résilience.
- [Plan B2B](../../plan_b2b_saas_v1.pdf) : archive non retenue.
- [Formation](../../plan_formation_ia_v1.pdf) : archive non retenue.
- [Architecture](../../stack_microservices_rust_v1.pdf) : architecture progressive et exploitation.

Ne pas considérer un plan, un écran ou une documentation comme une fonctionnalité livrée. Les chiffres des PDF sont des objectifs ou hypothèses, pas des performances constatées. Cette feuille de route ne constitue pas une validation de lancement.

## Suivi du travail

1. Lire les `AGENTS.md`, cette feuille et l’état Git avant de modifier le code.
2. Réserver une tâche dans le tableau avec son état et les fichiers concernés.
3. Pour un contrat partagé (profil, API, authentification), consigner le contrat et les dépendances avant de modifier les deux côtés.
4. À la livraison, mettre à jour l’état, les preuves de validation et les limites. Ne marquer **Terminé** que lorsque code, erreurs, tests pertinents et documentation concordent.
5. Ne jamais inscrire de secret, de jeton ou de contenu de CV réel dans ce document. Ne pas pousser ou déployer simplement parce qu’une case est cochée.

États : **À faire**, **En cours**, **À valider**, **Bloqué**, **Terminé**, **Différé**.

## Checklist obligatoire avant de terminer une tâche

Copier cette checklist dans le journal de livraison ou dans la section de la tâche, puis cocher uniquement ce qui a été réellement fait. Une tâche reste **À valider** tant que les points applicables ne sont pas cochés.

- [ ] La tâche, le périmètre et les fichiers modifiés sont indiqués dans le tableau de coordination.
- [ ] Les modifications concurrentes ont été relues juste avant l’édition ; aucun changement d’un autre agent n’a été écrasé.
- [ ] Le comportement demandé fonctionne sur le parcours normal.
- [ ] Les erreurs, entrées invalides et cas d’annulation pertinents ont un comportement compréhensible et testé.
- [ ] Aucune donnée, qualification, extrait de CV ou résultat n’a été inventé.
- [ ] Les contrôles d’accès, l’isolation entre comptes et la suppression des données ont été vérifiés lorsque la tâche touche à des données privées.
- [ ] Les interfaces, API, types, migrations et documentation concernés restent cohérents.
- [ ] Des tests pertinents ont été ajoutés ou mis à jour ; ils vérifient un comportement utile, sans seulement reproduire l’implémentation.
- [ ] Les vérifications réellement exécutées sont consignées avec leur résultat : par exemple `npm run check:all`, `go test ./...`, `cargo test` ou test manuel documenté.
- [ ] Les limites connues, tests non exécutés, dépendances externes et risques restants sont notés explicitement.
- [ ] Aucune clé, jeton, mot de passe, adresse personnelle ou contenu sensible n’a été ajouté au dépôt, aux tests ou à la documentation.
- [ ] La tâche est passée à **Terminé** seulement après la mise à jour du journal de livraison ; sinon elle reste **À valider** ou **Bloqué**.

### Format minimal du journal

| Tâche | Agent | Fichiers | Validation exécutée | Limites / suite | État |
| --- | --- | --- | --- | --- | --- |
| Exemple : C02 | Codex | chemins précis | commande et résultat, ou scénario manuel | ce qui n’est pas validé | À valider / Terminé |

## Socle déjà présent à préserver

- Interface React/Vite, accueil public, espace candidat et démonstration fictive.
- Profil manuel, offres manuelles, filtres, statuts de candidature, notes et export/restauration JSON.
- Service Go d’identité : inscription, connexion, profil initial créé avec le compte, sessions, déconnexion et révocation globale.
- Dossier privé PostgreSQL, copie locale par compte et détection des conflits de révision.
- Gestion du compte et suppression dans le périmètre du service d’identité ; purge interservices encore incomplète.
- Import PDF textuel NestJS, extraction déterministe, extraits visibles et correction avant confirmation.
- Service Rust de notifications transactionnelles : file PostgreSQL, SMTP, reprises bornées et états d’échec. Fournisseur réel non activé par la seule présence du code.

Ces éléments existent dans le dépôt ; leur exploitation en production reste à valider.

## Tableau de coordination

| ID | Priorité | Tâche | État | Responsable / réservation | Périmètre principal | Dépendances |
| --- | --- | --- | --- | --- | --- | --- |
| C01 | P0 | Finaliser la provenance durable du profil | Terminé | Codex | `src/cv-import/`, `web/src/profile-sources*`, `ProfileEvidence.tsx`, `CvImport*`, `domain.ts`, `App.tsx`, tests HTTP | Aucune |
| C02 | P0 | Profil professionnel structuré | Terminé | Codex | Modèle du profil, formulaire, extraction et migrations de données | C01 |
| C03 | P0 | Autoriser et isoler les analyses de CV | En cours | Codex | API NestJS, identité, stockage temporaire | Contrat d’identité |
| C04 | P0 | Activer et vérifier les emails réels | À faire | Libre | `services/auth/`, `services/notifications/`, configuration | Fournisseur et configuration disponibles |
| C05 | P0 | Fiabiliser les notifications et leur purge | À faire | Libre | File Rust, cycle de vie des comptes | Contrat interservices |
| C06 | P0 | Valider sessions, conflits et reprise locale | À faire | Libre | `auth-api.ts`, `App.tsx`, service Go | Coordination avec C01/C02 |
| C07 | P1 | Collecter et dédupliquer les offres | À faire | Libre | Futur domaine offres, plan existant | Sources autorisées et contrat offre |
| C08 | P1 | Comparaison expliquée profil–offre | En cours | Codex | Domaine comparaison et interface | C02 ; fonctionne aussi avec offres manuelles |
| C09 | P1 | Brouillons corrigibles et exportables | En cours | Codex (adaptateur Hermes local uniquement) | Domaine brouillons, adaptateur IA éventuel, interface | C02/C08 et validation du parcours principal |
| C10 | P1 | Notifications visibles et préférences | En cours | Codex | Interface et domaine notifications produit | Événements métier définis ; C05 pour emails |
| C11 | P1 | MFA / passkeys | À faire | Libre | Service Go et écrans compte | Parcours principal validé |
| C12 | P0 avant lancement | Préparer exploitation et recette | À faire | Libre | Déploiement, CI, supervision, sauvegardes, tests | À mener progressivement |
| C13 | P1 | Réconcilier la documentation avec le code | En cours | Codex | `B2C.md`, `PROJECT.md`, README, `AUDIT.md`, mémoire | Après chaque tranche |
| C14 | P2 | Abonnement éventuel | Différé | Non attribué | Paiement, quotas, droits | Parcours validé et décision commerciale |

P0 = fondations et fiabilité ; P1 = suite fonctionnelle ; P2 = après validation de la valeur. L’ordre ne signifie pas qu’il faut lancer de nouveaux microservices : documenter le besoin et le coût de toute infrastructure ajoutée.

## Critères de livraison par tâche

### C01 — Provenance durable du profil

- [x] Renvoyer les extraits contrôlés par le serveur à la confirmation.
- [x] Conserver origine, valeur confirmée, page, ligne et plage surlignée dans le dossier candidat.
- [x] Afficher les sources après rechargement et restauration JSON ; préserver les métadonnées lors de la synchronisation.
- [x] Marquer un champ modifié comme manuel et retirer ses anciennes preuves ; préserver les sources des champs inchangés.
- [x] Accepter les anciens dossiers sans provenance en indiquant une origine inconnue.
- [x] Refuser les métadonnées incohérentes à la restauration ; ne pas présenter un export éditable comme une preuve signée.
- [x] Terminer les vérifications API, interface et build avant livraison.

### C02 — Profil professionnel structuré

- [x] Définir les structures expériences et formations : intitulés, entreprise/établissement, dates, descriptions ; définir les autres champs utiles au B2C sans imposer de données inutiles.
- [x] Permettre ajout, modification et suppression manuels des éléments.
- [x] Faire évoluer extraction et preuves par élément, sans inventer les informations absentes.
- [x] Préserver les anciens profils, exports et dossiers synchronisés avec une migration explicite et testée.
- [x] Afficher les inconnus et les champs à vérifier ; distinguer préférences de recherche et faits du CV.

### C03 — Isolation des CV

- [ ] Authentifier les appels et rattacher chaque analyse au propriétaire côté serveur.
- [ ] Refuser la consultation ou confirmation par un autre compte, même avec l’identifiant de l’analyse.
- [ ] Définir explicitement le comportement du mode sans compte.
- [ ] Vérifier limites de taille/pages, fichiers invalides, scannés ou chiffrés, expiration et consommation des analyses.
- [ ] Tester absence d’accès croisé et de contenu sensible dans les journaux.
- [ ] Documenter la limite du stockage en mémoire ; ajouter un stockage partagé uniquement si le déploiement le nécessite.

### C04 — Emails réellement reçus

- [ ] Configurer SMTP ou fournisseur transactionnel avec secrets hors dépôt et identité d’expéditeur adaptée.
- [ ] Vérifier de bout en bout la réception et l’utilisation d’un lien de confirmation et de récupération sur une boîte de test autorisée.
- [ ] Contrôler expiration, usage unique, renvoi et messages d’erreur compréhensibles.
- [ ] Distinguer demande acceptée, acceptation SMTP et réception effective ; suivre les rebonds lorsque le fournisseur le permet.
- [ ] Rendre les échecs finaux détectables par une supervision exploitable.

### C05 — Fiabilité et suppression interservices

- [ ] Définir une clé d’idempotence et tester les demandes répétées.
- [ ] Éviter les messages devenus inutiles ou contenant un lien expiré ; définir expiration et annulation.
- [ ] Définir et appliquer la rétention des destinataires, corps et états de livraison.
- [ ] Relier les notifications au cycle de vie du compte et purger les données concernées lors de sa suppression.
- [ ] Prévoir une reprise durable si l’opération métier et la mise en file divergent.
- [ ] Documenter les limites de doublons après acceptation SMTP et les tester sans promettre un envoi « exactement une fois ».

### C06 — Sessions et synchronisation

- [ ] Tester plusieurs appareils et plusieurs onglets, notamment les renouvellements simultanés de session.
- [ ] Vérifier lecture, édition, perte réseau, reconnexion et erreur de stockage navigateur.
- [ ] Garantir que le choix de copie en conflit est explicite et que le travail local peut être exporté avant remplacement.
- [ ] Vérifier le transfert volontaire d’un dossier local vers un nouveau compte et les anciens caches communs.
- [ ] Tester changement de compte, déconnexion globale, récupération du mot de passe et suppression sans fuite de dossier entre comptes.

### C07 — Recherche d’offres

Lire d’abord [la spécification](superpowers/specs/2026-09-06-offers-collecte-deduplication-design.md) et [le plan existant](superpowers/plans/2026-09-06-offers-collecte-deduplication.md), puis vérifier les éventuelles modifications de Claude.

- [ ] Choisir et documenter les sources autorisées, leurs limites et leur fraîcheur.
- [ ] Collecter et normaliser les offres ; garder source, lien original et dates utiles.
- [ ] Dédupliquer sans perdre les candidatures et notes personnelles.
- [ ] Gérer expiration, retrait, erreurs et limitation de débit.
- [ ] Intégrer recherche, filtres et ajout au suivi candidat sans casser les offres manuelles.
- [ ] Séparer offres publiques mutualisables et données privées du candidat.

### C08 — Comparaison expliquée

- [ ] Définir les critères professionnels et leurs états : satisfait, non satisfait, inconnu.
- [ ] Relier les constats aux preuves ; une absence de preuve ne vaut pas absence de compétence.
- [ ] Écarter les informations personnelles sans rapport avec l’offre.
- [ ] Référencer les versions du profil, de l’offre et de la méthode ; invalider les résultats devenus obsolètes.
- [ ] Évaluer sur un corpus annoté distinct des exemples de réglage et comparer aux règles textuelles actuelles.
- [ ] Ne pas présenter un score comme une probabilité d’embauche ou une évaluation IA sans fondement mesuré.

### C09 — Brouillons et IA

- [ ] Définir les sorties utiles et faire valider le parcours principal avant activation.
- [ ] Utiliser seulement les informations confirmées ; laisser les inconnus visibles.
- [ ] Prévoir correction, validation explicite et export ; aucun envoi de candidature automatique.
- [ ] Encadrer fournisseur éventuel, flux de données, versions, délais, coût, erreurs et validation du schéma de sortie.
- [ ] Tester inventions factuelles, instructions malveillantes contenues dans les documents et indisponibilité du fournisseur.
- [ ] Conserver la lecture du dossier en cas de panne de génération.

### C10 — Notifications produit

- [x] Définir les événements utiles : résultat disponible, erreur nécessitant une action, rappel choisi par la personne. La première tranche transforme les messages de résultat et d’erreur déjà affichés par l’interface en notifications internes ; aucun rappel n’est créé sans choix explicite.
- [x] Ajouter consultation et états lu/non lu. Un centre de notifications local permet de consulter les vingt derniers événements de l’onglet et de les marquer lus à l’ouverture ; les préférences persistantes et les autres canaux restent à construire.
- [ ] Éviter les doublons et les notifications obsolètes ; respecter les préférences enregistrées.
- [ ] Ne pas assimiler un rappel à une autorisation d’envoyer une candidature.

### C11 — MFA / passkeys

Lire [la spécification existante](superpowers/specs/2026-09-06-auth-passkeys-tranche-b-design.md).

- [ ] Construire enrôlement après réauthentification, connexion et révocation.
- [ ] Vérifier challenge à usage unique, origine et RP ID côté serveur.
- [ ] Définir récupération et perte d’appareil avant activation.
- [ ] Tester rejeu, compte incorrect, expiration et parcours de secours.

### C12 — Recette et exploitation avant lancement

- [ ] Séparer développement, préproduction et production ; configurer HTTPS, secrets et services privés.
- [ ] Vérifier la CI distante, les migrations et le retour applicatif sur l’environnement choisi.
- [ ] Mettre en place sauvegardes et restauration réellement testée ; mesurer les objectifs RPO/RTO des PDF avant tout engagement.
- [ ] Superviser disponibilité, erreurs, files, latence et coûts avec responsables et procédures d’incident.
- [ ] Tester le parcours complet sur navigateur, mobile et clavier avec données fictives ou autorisées.
- [ ] Évaluer extraction et comparaison sur corpus ; consigner commit, environnement, protocole et résultats.
- [ ] Définir rétention, suppression et expiration des sauvegardes ; vérifier la purge effective.
- [ ] Préparer information utilisateur, droits, prestataires, régions et support ; faire revalider les questions réglementaires applicables à l’usage réel avant lancement.

Les PDF proposent notamment 95 % de champs factuels correctement extraits sur 100 CV, aucune invention critique sur 100 sorties examinées, et des tests de pertinence B2B sur 20 missions. Adapter et documenter le protocole B2C ; ne pas transposer ces seuils sans justification ni annoncer qu’ils sont atteints.

### C13 — Documentation cohérente

- [ ] Corriger les passages historiques qui décrivent encore le produit comme uniquement local ou comme un simple socle HTTP.
- [ ] Distinguer systématiquement code disponible, configuration requise, fonctionnalité testée et production déployée.
- [ ] Mettre à jour les README des services et leurs limites réelles après chaque livraison.
- [ ] Garder les PDF historiques et leurs archives ; ne pas les réécrire pour masquer un écart d’implémentation.

### C14 — Abonnement éventuel

- [ ] Décider de l’offre B2C et de ses unités après mesure de valeur et de coûts ; les tarifs B2B des PDF ne sont pas des tarifs B2C validés.
- [ ] Vérifier les événements de paiement côté serveur, leur signature, déduplication et ordre.
- [ ] Gérer droits, quotas, alertes, échec de paiement, résiliation et remboursement.
- [ ] Conserver lecture/export selon l’offre définie ; aucun dépassement payant sans accord explicite.

## Journal de livraison à compléter

| Date | Tâche | Agent | Changement / fichiers | Validation réellement exécutée | Commit ou limite restante |
| --- | --- | --- | --- | --- | --- |
| 2026-09-06 | Coordination | Codex | Création de cette feuille et ajout des repères dans les instructions projet | Vérification des liens locaux et de la présence des sections | Documentation uniquement ; tâches produit non clôturées |
| 2026-09-07 | Décision produit | Codex | Périmètre B2B et formation retirés de la feuille de route ; B2C exclusif inscrit dans les références | Liens et documents de référence relus | Les PDF restent des archives inchangées |
| 2026-09-07 | C01 | Codex | Extraits confirmés conservés dans le profil, restaurés depuis JSON, affichés dans « Mon profil » et retirés lors d’une modification manuelle | lint, typage, 55 tests Nest, `npm run test:e2e -- --runInBand` : 18 tests, `npm run build` Nest, 50 tests web et build Vite isolé réussis | Le build standard ne peut nettoyer `web/dist` tant que le serveur de développement Windows le verrouille ; le même build a réussi dans `.validation-dist`, dossier temporaire non suivi |
| 2026-09-07 | C02 (partie manuelle) | Codex | Ajout d’expériences et formations structurées, saisie, suppression et restauration compatible des anciens exports | `npm --prefix web test` : 52 tests ; `npm --prefix web run build` réussi | L’extraction et les preuves CV par expérience ou formation restent à construire ; C02 demeure en cours |
| 2026-09-07 | C02 | Codex | Profil complété avec nom, email, téléphone et ville ; extraction améliorée pour coordonnées, villes et compétences ; expériences et diplômes sélectionnables avec extraits sources | `npm run check:all` : 59 tests Nest, 18 tests HTTP, 52 tests web et builds réussis ; `go test ./... -count=1` réussi | L’extraction reste déterministe : les lignes de parcours sont proposées telles quelles puis corrigées par la personne |
| 2026-09-07 | C10 (première tranche) | Codex | Centre de notifications local dans l’en-tête : les messages d’information et erreurs déjà présentés deviennent consultables, avec compteur et état lu/non lu | `npm test -- --run` : 54 tests front réussis ; `npm run build` Vite réussi | Historique uniquement en mémoire et sans préférences persistantes ; aucune notification email ou candidature automatique n’est ajoutée |
| 2026-09-07 | C13 (revue) | Codex | Références B2C, README, audit et variables d’environnement alignés avec l’import CV authentifié, Ollama local et les notifications internes ; consignes Claude retirées de la coordination | 66 tests NestJS, 21 tests HTTP, 54 tests front, builds Nest/Vite, `go test ./... -count=1`, `cargo fmt --check`, `cargo test` et `cargo clippy --all-targets -- -D warnings` réussis | Services de développement arrêtés ; le test Rust demandant une PostgreSQL temporaire reste ignoré |

À chaque reprise : commencer par le tableau, vérifier l’état Git et les dernières preuves du journal. Ne pas déduire qu’une autre session travaille encore à partir d’une ancienne réservation.
