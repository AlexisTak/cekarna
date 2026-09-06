# Cekarna — dossier stratégique V2.0

**Historique B2B : priorité désormais différée.** Décision ultérieure de l’utilisateur : commencer par l’application B2C pour chercheurs d’emploi. Référence active : `../cekarna_website/docs/B2C.md`. Les PDF restent inchangés pour conserver le cadrage B2B.

Révision du 6 septembre 2026. Cible retenue par le porteur du projet : **SaaS B2B pour cabinets de recrutement**. Le segment tech, les prix, quotas et objectifs chiffrés restent des propositions à valider.

## Documents remplacés à la racine

1. `cahier_des_charges_cekarna.pdf` : périmètre, règles métier, données et recette — 4 pages.
2. `optimisation_cekarna_v1.pdf` : charge, pipeline, simulation de coûts et résilience — 4 pages.
3. `plan_b2b_saas_v1.pdf` : positionnement, grille expérimentale, pilotes et lancement — 5 pages.
4. `plan_formation_ia_v1.pdf` : offre future et programme reproductible — 3 pages.
5. `stack_microservices_rust_v1.pdf` : architecture NestJS progressive et conditions de migration — 4 pages.

Les noms historiques contenant `v1` sont conservés pour ne pas casser les références existantes. Le contenu et les métadonnées indiquent **V2.0**. Le dossier assemblé est `dossier_cekarna_v2.pdf`, avec signets par document.

## Ce qui a changé

- Un seul produit prioritaire et une distinction explicite entre existant, exigences et hypothèses.
- Suppression des promesses de performance, de rentabilité ou de conformité non démontrées.
- Quotas définis, exemple économique recalculable, pilote accompagné et critères de décision.
- Exigences de traçabilité, isolation, suppression, reprise et supervision humaine.
- Sources officielles cliquables, consultées le 6 septembre 2026, pour les éléments techniques et réglementaires.
- Mise en page commune, polices incorporées et texte sélectionnable.

Les prix sont des hypothèses internes, pas des tarifs publiés. Ces documents préparent une offre ; ils ne certifient ni la qualité du logiciel futur ni sa conformité juridique.

## Originaux et sources

`archives/originaux_20260906_013919/` contient les cinq fichiers initiaux et un manifeste SHA-256. Ne pas écraser cette archive lors d’une révision.

`sources/author_content.py` est la source éditoriale des cinq textes. `sources/cekarna_v2.json` en est la représentation générée ; `sources/build_pdfs.py` construit les PDF dans `generated/`. Ne pas modifier les deux sources indépendamment : modifier le Python puis régénérer le JSON.

Depuis la racine du projet, avec Python et les bibliothèques reportlab/pypdf :

```sh
python documents/sources/author_content.py
python documents/sources/build_pdfs.py
```

Le générateur utilise les polices Calibri de Windows. Adapter ces chemins pour un autre système. Il vérifie la pagination et les titres. Examiner les rendus avant de recopier les PDF générés vers la racine. Les aperçus de la révision courante sont dans `previews/`.

## Sources principales

- [CNIL — Guide du recrutement](https://www.cnil.fr/fr/le-guide-du-recrutement)
- [Commission européenne — AI Act](https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai)
- [NestJS — Queues](https://docs.nestjs.com/techniques/queues)
- [pgvector](https://github.com/pgvector/pgvector)
- [BullMQ — Idempotent jobs](https://docs.bullmq.io/patterns/idempotent-jobs)
- [Stripe — Webhooks](https://docs.stripe.com/webhooks)

Les prescriptions du dossier sont des choix de conception proposés. Les liens ne prouvent pas que Cekarna les a déjà implémentés. Recontrôler les références évolutives avant commercialisation.
