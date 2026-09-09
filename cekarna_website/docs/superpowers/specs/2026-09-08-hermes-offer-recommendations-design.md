# Design — Recommandations d’offres avec Hermes côté serveur

Date : 2026-09-08. Statut : approuvé par la demande utilisateur.

## Objectif

Proposer à une personne connectée des offres adaptées à son profil professionnel
confirmé, sans envoyer le PDF brut au modèle et sans lancer un appel par annonce.

## Flux borné

1. Le navigateur envoie uniquement poste, ville, contrat, compétences, résumé,
   expériences et formations enregistrés dans le dossier candidat.
2. NestJS charge au maximum 100 offres actives depuis le service mutualisé.
3. Un préfiltre déterministe compare les termes professionnels, la ville et le
   contrat, puis retient au maximum 6 annonces.
4. Un unique appel serveur à serveur vers Hermes reçoit ces données compactes. Le contexte est limité à
   4 096 tokens, la température à zéro et le modèle reste chargé cinq minutes.
5. Le serveur accepte au maximum 5 recommandations. Chaque preuve doit être un
   extrait littéral du profil et de l’offre correspondante ; sinon elle est retirée.
   Si Hermes ne respecte pas le schéma, le préfiltre peut conserver des suggestions
   au niveau « à vérifier » uniquement lorsqu’il peut produire lui-même deux extraits
   littéraux correspondants. L’interface identifie alors ce repli comme textuel.
6. Le résultat est conservé 15 minutes dans un cache mémoire borné par compte,
   profil et lot d’offres. Une nouvelle version invalide naturellement la clé.

## Interface et limites

La recherche manuelle reste disponible. La personne déclenche l’analyse depuis la
page des offres et choisit elle-même d’ajouter une recommandation à son suivi.
L’interface affiche les extraits comparés, le modèle utilisé et rappelle que le
niveau de correspondance n’est ni une probabilité d’embauche ni une décision.
Une panne Hermes ou du collecteur produit une erreur compréhensible sans modifier
le dossier candidat. Le cache est local au processus et ne remplace pas un stockage
partagé si NestJS devient multi-instance.

Hermes peut tourner sur le poste en développement. En production, NestJS vise une
instance centrale privée et authentifiée ; les navigateurs ne connaissent ni son
URL ni sa clé. Le contrat de déploiement est décrit dans `../../DEPLOIEMENT_IA.md`.
