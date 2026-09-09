# Cekarna — travail restant et coordination

État de référence : 6 septembre 2026. Document de travail partagé, à actualiser après chaque livraison.

## Périmètre et références

Le périmètre décidé par l’utilisateur est le **B2C exclusivement : application web pour particuliers en recherche d’emploi**. Le cahier des charges V3 décrit ce produit actif. Les quatre autres PDF V2 décrivent un produit B2B et une formation qui ne seront pas développés ; seuls leurs principes de preuves, de correction humaine, d’isolation et de fiabilité restent utiles. Les demandes ultérieures de l’utilisateur priment.

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
- Gestion du compte et suppression avec purge interservices des notifications ; la suppression est refusée clairement si la dépendance de purge est indisponible.
- Import PDF textuel NestJS, extraction déterministe, extraits visibles et correction avant confirmation.
- Service Rust de notifications transactionnelles : file PostgreSQL, SMTP, reprises bornées et états d’échec. Fournisseur réel non activé par la seule présence du code.

Ces éléments existent dans le dépôt ; leur exploitation en production reste à valider.

## Tableau de coordination

| ID | Priorité | Tâche | État | Responsable / réservation | Périmètre principal | Dépendances |
| --- | --- | --- | --- | --- | --- | --- |
| C01 | P0 | Finaliser la provenance durable du profil | Terminé | Codex | `src/cv-import/`, `web/src/profile-sources*`, `ProfileEvidence.tsx`, `CvImport*`, `domain.ts`, `App.tsx`, tests HTTP | Aucune |
| C02 | P0 | Profil professionnel structuré | Terminé | Codex | Modèle du profil, formulaire, extraction et migrations de données | C01 |
| C03 | P0 | Autoriser et isoler les analyses de CV | Terminé | Codex | API NestJS, identité, stockage temporaire | Contrat d’identité validé |
| C04 | P0 | Activer et vérifier les emails réels | À faire | Libre | `services/auth/`, `services/notifications/`, configuration | Fournisseur et configuration disponibles |
| C05 | P0 | Fiabiliser les notifications et leur purge | Terminé | Codex | File Rust, cycle de vie des comptes | Contrat interservices |
| C06 | P0 | Valider sessions, conflits et reprise locale | Terminé | Codex | `auth-api.ts`, `App.tsx`, service Go | C01/C02 validés |
| C07 | P1 | Collecter et dédupliquer les offres | Terminé | Codex | `services/offers`, façade NestJS et recherche frontend | Activation France Travail conditionnée aux identifiants et conditions acceptées |
| C08 | P1 | Comparaison expliquée profil–offre | Terminé | Codex | Domaine comparaison et interface | C02 ; fonctionne aussi avec offres manuelles |
| C09 | P1 | Brouillons corrigibles et exportables | Terminé | Codex | Domaine brouillons, adaptateur Hermes local, interface | C02/C08 et validation du parcours principal |
| C10 | P1 | Notifications visibles et préférences | Terminé | Codex | Interface et domaine notifications produit | Événements métier définis ; C05 pour emails |
| C11 | P1 | MFA / passkeys | Terminé | Codex | Service Go et écrans compte | Parcours principal validé |
| C12 | P0 avant lancement | Préparer exploitation et recette | Bloqué | Libre | Déploiement, CI, supervision, sauvegardes, tests ; `../desktop-admin/` | Hébergeur, domaines, fournisseur SMTP et responsables d’exploitation à choisir |
| C13 | P1 | Réconcilier la documentation avec le code | Terminé | Codex | `B2C.md`, `PROJECT.md`, README, `AUDIT.md`, mémoire | À revalider après chaque nouvelle tranche |
| C14 | P2 | Abonnement éventuel | Différé | Non attribué | Paiement, quotas, droits | Parcours validé et décision commerciale |
| C15 | P1 | Recommandations d’offres avec Hermes | Terminé | Codex | API NestJS, offres publiques et recherche frontend | C02, C07, C08 et Hermes local |
| C16 | P1 | Industrialiser le préfiltrage et les brouillons IA | Terminé | Codex | Préfiltrage Rust, cache par empreinte, orchestration Hermes et brouillon choisi | C02, C07, C09 et C15 |

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

- [x] Authentifier les appels et rattacher chaque analyse au propriétaire côté serveur.
- [x] Refuser la consultation ou confirmation par un autre compte, même avec l’identifiant de l’analyse.
- [x] Définir explicitement le comportement du mode sans compte : l’import exige une session active.
- [x] Vérifier limites de taille/pages, fichiers invalides, scannés ou chiffrés, expiration et consommation des analyses.
- [x] Tester absence d’accès croisé et de contenu sensible dans les journaux.
- [x] Documenter la limite du stockage en mémoire ; ajouter un stockage partagé uniquement si le déploiement le nécessite.

### C04 — Emails réellement reçus

- [ ] Configurer SMTP ou fournisseur transactionnel avec secrets hors dépôt et identité d’expéditeur adaptée.
- [ ] Vérifier de bout en bout la réception et l’utilisation d’un lien de confirmation et de récupération sur une boîte de test autorisée.
- [ ] Contrôler expiration, usage unique, renvoi et messages d’erreur compréhensibles.
- [ ] Distinguer demande acceptée, acceptation SMTP et réception effective ; suivre les rebonds lorsque le fournisseur le permet.
- [ ] Rendre les échecs finaux détectables par une supervision exploitable.

### C05 — Fiabilité et suppression interservices

- [x] Définir une clé d’idempotence et tester les demandes répétées. Le service Go calcule l’empreinte SHA-256 stable du message et le service Rust renvoie l’enregistrement existant sur répétition.
- [x] Éviter les messages devenus inutiles ou contenant un lien expiré ; définir expiration et annulation. L’auth transmet l’expiration réelle des liens de vérification et récupération ; le worker annule les notifications expirées avant SMTP.
- [x] Définir et appliquer la rétention des destinataires, corps et états de livraison. Les états terminaux sont purgés après 30 jours par défaut ; les envois en attente ou en cours sont préservés.
- [x] Relier les notifications au cycle de vie du compte et purger les données concernées lors de sa suppression. Les emails envoyés par l’auth portent désormais leur propriétaire ; la suppression appelle la purge interne avant d’effacer le compte.
- [x] Prévoir une reprise durable si l’opération métier et la mise en file divergent. Le jeton d'authentification et l'intention d'email sont créés dans une même transaction PostgreSQL, puis une outbox réessaie avec une clé stable jusqu'à acceptation ou expiration.
- [x] Documenter les limites de doublons après acceptation SMTP et les tester sans promettre un envoi « exactement une fois ». Les répétitions auth→file conservent la même empreinte ; une coupure après acceptation SMTP demeure explicitement observable et peut produire un doublon.

### C06 — Sessions et synchronisation

- [x] Tester plusieurs appareils et plusieurs onglets, notamment les renouvellements simultanés de session.
- [x] Vérifier lecture, édition, perte réseau, reconnexion et erreur de stockage navigateur.
- [x] Garantir que le choix de copie en conflit est explicite et que le travail local peut être exporté avant remplacement.
- [x] Vérifier le transfert volontaire d’un dossier local vers un nouveau compte et les anciens caches communs.
- [x] Tester changement de compte, déconnexion globale, récupération du mot de passe et suppression sans fuite de dossier entre comptes.

### C07 — Recherche d’offres

Lire d’abord [la spécification](superpowers/specs/2026-09-06-offers-collecte-deduplication-design.md) et [le plan existant](superpowers/plans/2026-09-06-offers-collecte-deduplication.md), puis vérifier les éventuelles modifications de Claude.

- [x] Choisir et documenter les sources autorisées, leurs limites et leur fraîcheur. La liste blanche désactive France Travail sans activation explicite et impose un intervalle minimal de 15 minutes.
- [x] Collecter et normaliser les offres ; garder source, lien original et dates utiles. Le brut, son SHA-256 et les chemins JSON de chaque champ sont conservés ; une valeur absente reste vide.
- [x] Dédupliquer sans perdre les candidatures et notes personnelles. Les règles identifiant source et empreinte normalisée gardent tous les membres et leurs décisions ; le dossier candidat reste séparé.
- [x] Gérer expiration, retrait, erreurs et limitation de débit. Une collecte complète désactive les offres disparues, conserve les documents invalides et isole les échecs par source.
- [x] Intégrer recherche, filtres et ajout au suivi candidat sans casser les offres manuelles. NestJS sert la recherche paginée et le frontend copie une offre dans le suivi uniquement sur action explicite.
- [x] Séparer offres publiques mutualisables et données privées du candidat. SQLite ne contient ni statut, ni note, ni candidature ; ces données restent dans le dossier privé synchronisé.

### C08 — Comparaison expliquée

- [x] Définir les critères professionnels et leurs états : satisfait, non satisfait, inconnu. La méthode déterministe couvre ville souhaitée, contrat et compétences confirmées.
- [x] Relier les constats aux preuves ; une absence de preuve ne vaut pas absence de compétence. Une contradiction explicite est requise pour `not_satisfied` ; sinon le critère reste `unknown`.
- [x] Écarter les informations personnelles sans rapport avec l’offre. Les règles n'utilisent que les champs professionnels et l'adaptateur Hermes filtre coordonnées, notes et critères personnels côté navigateur et serveur.
- [x] Référencer les versions du profil, de l’offre et de la méthode ; invalider les résultats devenus obsolètes. Le rapport porte `text-rules-v2` et des références déterministes recalculées à chaque modification.
- [x] Évaluer sur un corpus annoté distinct des exemples de réglage et comparer aux règles textuelles actuelles. Quatre scénarios, douze décisions attendues, sont exécutés comme tests de régression séparés.
- [x] Ne pas présenter un score comme une probabilité d’embauche ou une évaluation IA sans fondement mesuré. L'interface affiche uniquement les trois états, les preuves et la version de méthode.

### C09 — Brouillons et IA

- [x] Définir les sorties utiles et faire valider le parcours principal avant activation. La sortie livrée est un brouillon texte local par offre, séparé de l'analyse Hermes facultative.
- [x] Utiliser seulement les informations confirmées ; laisser les inconnus visibles. Le modèle reprend les champs du profil et de l'offre tels qu'enregistrés et utilise des passages entre crochets lorsqu'ils manquent.
- [x] Prévoir correction, validation explicite et export ; aucun envoi de candidature automatique. Objet et corps sont modifiables puis exportables en `.txt` ; aucune action d'envoi n'existe.
- [x] Encadrer fournisseur éventuel, flux de données, versions, délais, coût, erreurs et validation du schéma de sortie. Hermes reste local, facultatif, borné à 60 secondes et son JSON est filtré ; le brouillon principal n'en dépend pas.
- [x] Tester inventions factuelles, instructions malveillantes contenues dans les documents et indisponibilité du fournisseur. Le modèle déterministe ignore description et notes, les preuves Hermes doivent être littérales et la panne est testée.
- [x] Conserver la lecture du dossier en cas de panne de génération. L'état du dossier et le brouillon local ne dépendent pas du service Ollama.

### C10 — Notifications produit

- [x] Définir les événements utiles : résultat disponible, erreur nécessitant une action, rappel choisi par la personne. La première tranche transforme les messages de résultat et d’erreur déjà affichés par l’interface en notifications internes ; aucun rappel n’est créé sans choix explicite.
- [x] Ajouter consultation et états lu/non lu. Le centre conserve localement les vingt derniers événements et leur lecture, dans un historique isolé par compte sur l’appareil.
- [x] Éviter les doublons et les notifications obsolètes ; respecter les préférences enregistrées. Les informations peuvent être désactivées, l’historique effacé et chaque rappel possède un identifiant stable lié à l’offre et à sa date.
- [x] Ne pas assimiler un rappel à une autorisation d’envoyer une candidature. Le rappel est choisi dans le formulaire d’offre, reste dans le dossier synchronisé et indique explicitement qu’aucun envoi n’a eu lieu.

### C11 — MFA / passkeys

Lire [la spécification existante](superpowers/specs/2026-09-06-auth-passkeys-tranche-b-design.md).

- [x] Construire enrôlement après réauthentification, connexion et révocation. Plusieurs passkeys nommées sont gérées dans la page compte ; la session n’est créée qu’après le second facteur.
- [x] Vérifier challenge à usage unique, origine et RP ID côté serveur. Les états de cérémonie et de transition expirent après cinq minutes dans Redis et sont consommés atomiquement.
- [x] Définir récupération et perte d’appareil avant activation. Une réinitialisation du mot de passe supprime toutes les passkeys et sessions ; la page explique cette conséquence avant activation.
- [x] Tester rejeu, compte incorrect, expiration et parcours de secours. Les intégrations PostgreSQL/Redis couvrent l’absence de session intermédiaire, le rattachement au compte, la consommation, l’expiration simulée et la purge lors de la récupération.

### C15 — Recommandations d’offres avec Hermes

Lire [la spécification](superpowers/specs/2026-09-08-hermes-offer-recommendations-design.md).

- [x] Compacter uniquement les données professionnelles confirmées et ne jamais transmettre le PDF brut, les coordonnées ou les notes privées.
- [x] Préfiltrer localement un lot borné puis appeler Hermes une seule fois pour plusieurs offres.
- [x] Conserver seulement les recommandations reliées à des extraits littéraux du profil et de l’annonce.
- [x] Mettre en cache par compte et version des données, avec expiration et taille maximales.
- [x] Afficher les recommandations séparément de la recherche et exiger une action pour ajouter une offre au suivi.
- [x] Tester indisponibilité, données malveillantes, preuves inventées, limites de lot et réutilisation du cache.

### C16 — Préfiltrage Rust et brouillons IA

- [x] Déplacer le préfiltrage borné vers Rust et ne transmettre que les données professionnelles confirmées.
- [x] Mettre en cache les sélections par empreinte du profil, des filtres et des offres, sans stocker le CV brut ni les coordonnées.
- [x] Borner les appels Hermes et conserver un seul appel groupé par sélection.
- [x] Générer une lettre uniquement après le choix explicite d’une offre, avec correction et export avant toute utilisation.
- [x] Refuser ou neutraliser toute affirmation qui ne peut pas être reliée aux faits transmis.

### C12 — Recette et exploitation avant lancement

**Blocage actuel :** les contrôles locaux sont disponibles, mais la recette de
préproduction ne peut pas être exécutée sans environnement cible, domaine HTTPS,
gestionnaire de secrets, fournisseur SMTP et responsables des incidents choisis.

- [x] Créer un tableau de supervision local séparé du site candidat. L’application Tauri contrôle les adresses de bouclage depuis Rust et peut démarrer ou arrêter les services Cekarna explicitement autorisés : les services Compose `auth` et `notifications`, sans supprimer leurs volumes, et les processus API, offres et Ollama qu’elle a elle-même lancés. La préparation locale des offres synchronise un jeton ignoré par Git et charge uniquement les fixtures synthétiques. La disponibilité NestJS contrôle identité, offres et présence du modèle Hermes ; le panneau nomme la dépendance indisponible.

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

- [x] Corriger les passages historiques qui décrivent encore le produit comme uniquement local ou comme un simple socle HTTP.
- [x] Distinguer systématiquement code disponible, configuration requise, fonctionnalité testée et production déployée.
- [x] Mettre à jour les README des services et leurs limites réelles après chaque livraison.
- [x] Garder les PDF historiques et leurs archives ; ne pas les réécrire pour masquer un écart d’implémentation.

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
| 2026-09-07 | C06 | Codex | Conflit de dossier sans réécriture automatique et transfert confirmé du dossier local couverts côté frontend | 56 tests front et build Vite réussis ; `docker compose -f compose.yaml -f compose.test.yaml run --build --rm tests` réussi avec PostgreSQL, Redis et détecteur de courses | Le test ne remplace pas un essai ergonomique sur deux appareils physiques, mais couvre les contrats, conflits et sessions réelles |
| 2026-09-07 | C03 | Codex | Contrôle direct de l’identité ajouté pour l’import ; extraction et confirmation restent liées au propriétaire côté serveur | 69 tests NestJS, 21 tests HTTP et build NestJS réussis | Stockage temporaire en mémoire par instance ; le déploiement multi-instance exigera un stockage partagé ou une affinité de session |
| 2026-09-07 | C05 (idempotence) | Codex | Clé d’idempotence SHA-256 transmise par l’auth et contrainte unique ajoutée à la file Rust | `go test ./... -count=1`, `cargo test` et `cargo clippy --all-targets -- -D warnings` réussis | Rétention, annulation et purge lors de la suppression du compte restent à construire |
| 2026-09-07 | C13 (pages légales) | Codex | Footer et routes pour mentions légales, confidentialité, cookies et CGU ; identité de l’éditeur configurable hors dépôt | 56 tests front, build Vite, `cargo test` et Clippy réussis | Renseigner `VITE_LEGAL_PUBLISHER` et `VITE_LEGAL_CONTACT` avec les données réelles avant publication |
| 2026-09-07 | C12 (supervision locale) | Codex | Création de `../desktop-admin/`, application Tauri distincte du site public ; contrôles Rust de l’API, identité, notifications et Ollama ; commandes limitées aux services Compose `auth`/`notifications` et aux processus locaux créés par le panneau ; exclusion de `src-tauri/target` de la surveillance Vite sous Windows | `npm run build`, `cargo fmt --check`, `cargo check` et `npm run tauri:build -- --debug --no-bundle` réussis ; `npm run tauri:dev` lancé avec fenêtre Tauri ouverte ; contrôles API et identité retournent HTTP 200 | Les opérations portant sur les données, l’authentification d’opérateur et les procédures d’incident restent à définir avant tout accès métier ou action destructive |
| 2026-09-07 | C04 / C12 (notifications locales) | Codex | Compose notifications complété par Mailpit local ; configuration desktop de développement générable avec secrets hors dépôt ; SMTP non chiffré limité à `APP_ENV=development`, STARTTLS restant le défaut | `cargo fmt --check`, `cargo test` : 5 réussis, 1 ignoré, Clippy strict ; build desktop ; démarrage Compose ; `/health/live` et `/health/ready` notifications retournent HTTP 200 | Mailpit capte les emails localement sur le poste ; configuration d’un fournisseur réel et test de réception externe restent à faire pour C04 |
| 2026-09-07 | C05 (suppression interservices) | Codex | Migration propriétaire des notifications, contrat auth→notifications enrichi et purge interne avant suppression d’un compte | `go test ./...` et `cargo check` réussis | Une panne de la purge refuse la suppression afin de ne pas laisser de notifications orphelines ; une reprise durable transactionnelle reste à construire |
| 2026-09-07 | C05 (expiration) | Codex | Ajout de `expires_at`, statut `cancelled` et transmission des délais réels des liens d’authentification | `go test ./...`, `cargo test` et Clippy strict réussis | Les opérations auth et mise en file ne sont pas encore coordonnées par une outbox durable |
| 2026-09-07 | C10 | Codex | Préférence d’informations, historique effaçable et isolé par compte, rappels manuels persistés dans les offres et dédupliqués par offre/date | 57 tests frontend et build Vite réussis | Rappels évalués uniquement lorsque l’application est ouverte ; aucune notification système, aucun email et aucun envoi de candidature |
| 2026-09-07 | C05 | Codex | Outbox PostgreSQL atomique entre jetons d'authentification et intentions d'email, worker de reprise vers la file Rust et même clé d'idempotence à chaque tentative | `go test ./... -count=1`, intégration Docker PostgreSQL/Redis avec détecteur de courses, `cargo fmt --check`, `cargo test` et Clippy strict réussis | Une acceptation SMTP suivie d'une coupure avant réponse peut encore provoquer un doublon ; cette limite est documentée et doit être supervisée chez le fournisseur |
| 2026-09-07 | C08 | Codex | Comparaison déterministe à trois états, preuves visibles, références de version et filtrage des données personnelles pour Hermes | 62 tests frontend, dont 12 décisions du corpus annoté ; 70 tests NestJS, lint, typage et builds réussis | Le corpus protège le contrat fonctionnel mais ne mesure pas une performance représentative sur des CV et offres réels ; aucun score qualité n'est affiché |
| 2026-09-07 | C09 | Codex | Brouillon texte déterministe construit avec les informations confirmées, inconnus visibles, correction et export explicites, sans envoi automatique | Tests frontend du contenu manquant et d'une instruction malveillante ; test NestJS d'indisponibilité Hermes ; suites et builds complets réussis | Le brouillon n'est pas persisté dans le dossier : l'utilisateur doit l'exporter avant de fermer ou changer d'offre |
| 2026-09-07 | C13 | Codex | README racine, frontend, cadrage projet et feuille de route alignés avec le produit B2C réellement livré ; ancien B2B identifié comme archive abandonnée | Recherche des formulations historiques et concordance avec C05, C08 et C09 vérifiées | C12 reste bloqué avant lancement tant que l'environnement cible et les prestataires ne sont pas choisis |
| 2026-09-08 | C07 | Codex | Service Rust de collecte et déduplication, brut et provenance conservés, liste blanche France Travail/feed/fichier, façade NestJS et recherche frontend avec ajout explicite au suivi privé | `cargo fmt --check`, 9 tests Rust, Clippy strict ; `npm run check:all` : 74 tests NestJS, 21 tests HTTP, 66 tests web et builds ; trajet réel NestJS→Rust vérifié avec filtre accent-insensible et contrôle 401 interne | France Travail reste désactivé jusqu’à fourniture des identifiants et acceptation de ses conditions ; Docker Desktop était arrêté lors de la tentative locale, le build d’image est aussi contrôlé par `.github/workflows/offers.yml` |
| 2026-09-08 | C06 (origine locale) | Codex | Alignement du frontend, du cookie Strict et de la liste CORS de l’identité sur `127.0.0.1`; message spécifique si l’origine est refusée | Santé identité 200, requête CSRF avec origine réelle 200 et en-têtes CORS ; `go test ./... -count=1`, 66 tests web et build Vite réussis | Configuration de développement locale ; l’origine HTTPS de production reste à définir dans C12 |

| 2026-09-08 | C11 | Codex | Passkeys WebAuthn facultatives : enrôlement réauthentifié, plusieurs appareils nommés, étape MFA sans session intermédiaire, révocation, invitation dans l’espace candidat et récupération supprimant passkeys et sessions | `npm run check:all` : 74 tests NestJS, 21 tests HTTP, 69 tests web et deux builds ; tests et vet Go ; intégration Docker PostgreSQL/Redis avec détecteur de courses ; Govulncheck sans vulnérabilité appelée ; service migré et prêt | L’essai matériel Windows Hello/Touch ID et la configuration du RP ID HTTPS réel font partie de la recette C12 |
| 2026-09-08 | C15 / documentation | Codex | Recommandations d’offres sur demande : profil professionnel compacté, préfiltre de 100 offres, lot Hermes limité à 6, preuves littérales, cache et quota par compte ; cahier des charges V3 B2C régénéré | `npm run check:all` : 78 tests NestJS, 23 tests HTTP, 70 tests web et deux builds, puis test web du quota : 71 tests et build ; contrôle visuel des 4 pages du PDF | La pertinence doit encore être mesurée sur un corpus autorisé dans la recette C12 ; France Travail et les services de production restent à configurer |
| 2026-09-09 | C15 / C12 local | Codex | Service d’offres ajouté au panneau Tauri avec préparation locale ; configuration NestJS/Rust synchronisée ; repli textuel explicite quand Hermes respecte mal son schéma, avec preuves littérales calculées uniquement depuis les données fournies ; profil Hermes Cekarna fourni | Trajet authentifié réel NestJS → offres Rust → Hermes `hermes3:3b` : 1 offre analysée, 1 suggestion et 4 preuves, puis compte synthétique supprimé ; `npm run check:all` : 80 tests NestJS, 23 tests HTTP, 71 tests web et deux builds ; test Rust Tauri, Clippy strict et build desktop réussis | Le repli est affiché « à vérifier » et ne devient jamais une probabilité ; France Travail reste désactivé |
| 2026-09-09 | C12 (disponibilité locale) | Codex | Nouvelle route NestJS `/health/ready` contrôlant identité, offres et présence du modèle Hermes ; panneau Tauri raccordé avec diagnostic par dépendance | Contrôle réel : état `ready`, trois dépendances `up`, modèle `hermes3:3b` ; `npm run check:all`, puis test du 503 ajouté : 83 tests NestJS, 24 tests HTTP, 71 tests web et deux builds ; 2 tests Rust Tauri, Clippy strict et build desktop réussis | Contrôle local uniquement ; alertes persistantes, responsables d’incident et environnement de préproduction restent bloqués par les choix d’exploitation |
| 2026-09-09 | C15 (session des recommandations) | Codex | Les appels IA protégés renouvellent désormais une fois le jeton d’accès expiré avant de rejouer la requête ; erreurs de session et profil distinguées ; l’état sans offre explique les filtres actifs | Parcours réel dans Chrome après expiration : erreur supprimée et réponse reçue ; identité, API, offres et Ollama en HTTP 200 ; `npm run check:all` : 83 tests NestJS, 24 tests HTTP, 75 tests web et deux builds réussis | Une session dont le refresh a réellement expiré exige toujours une reconnexion explicite, indiquée dans l’interface |
| 2026-09-09 | C16 | Codex | Préfiltrage déplacé dans le service Rust : 500 offres examinées au maximum, six transmises à Hermes, cache de quinze minutes par empreinte sans CV brut ni coordonnées ; première analyse automatique pour chaque profil actif nouveau ou modifié ; file Hermes limitée à deux appels concurrents ; brouillon assisté créé seulement sur l’offre choisie avec preuves littérales, correction et export | Parcours réel Chrome : brouillon produit pour une offre synthétique avec un rapprochement vérifié et repli sûr ; API, identité, offres et Ollama en HTTP 200 ; `cargo test` : 12 tests, Clippy strict ; `npm run check:all` : 86 tests NestJS, 24 tests HTTP, 76 tests web et deux builds réussis | Le calcul automatique concerne les personnes actives lorsqu’elles ouvrent leur espace ; une analyse hors connexion de tous les comptes demanderait une file durable et un événement de profil dans l’environnement de production |

À chaque reprise : commencer par le tableau, vérifier l’état Git et les dernières preuves du journal. Ne pas déduire qu’une autre session travaille encore à partir d’une ancienne réservation.
