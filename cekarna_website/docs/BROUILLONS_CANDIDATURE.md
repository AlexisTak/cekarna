# Brouillons de candidature

Le parcours principal produit un brouillon texte local à partir de l'intitulé et
de l'entreprise de l'offre, puis du titre, des compétences et du nom confirmés
par la personne. Un champ absent reste un passage entre crochets. La description
de l'offre, ses notes et les résultats Hermes ne sont pas recopiés : une instruction
malveillante placée dans une annonce ne peut donc pas modifier ce modèle.

Le brouillon reste modifiable avant un export `.txt`. L'application ne possède
aucune route ni action d'envoi de candidature. Repartir du modèle remplace les
corrections courantes et demande donc une action explicite sur le bouton associé.

Hermes est appelé par l’API Cekarna pour la comparaison et la sélection de preuves
du brouillon assisté. Son URL, son modèle, son authentification, son délai et ses
erreurs sont encadrés par `HERMES_BASE_URL`, `HERMES_MODEL`, `HERMES_API_KEY`, un
délai de 60 secondes et une validation du JSON retourné. Une panne n'empêche ni
de lire le dossier, ni de préparer le brouillon déterministe, ni de l'exporter.
Le navigateur ne contacte jamais Hermes directement ; voir `DEPLOIEMENT_IA.md`.
