# Comparaison profil–offre

La méthode `text-rules-v2` compare uniquement la ville souhaitée, le contrat et
les compétences confirmées du profil avec les champs professionnels de l'offre.
Elle n'utilise ni nom, ni email, ni téléphone, ni âge, ni genre. Elle ne produit
aucun score et ne prédit ni recrutement ni réussite dans le poste.

Chaque critère possède un des trois états suivants :

- `satisfied` : les deux entrées contiennent une concordance explicite ;
- `not_satisfied` : les deux entrées se contredisent explicitement, comme deux
  types de contrat différents ;
- `unknown` : une donnée ou une preuve manque. L'absence d'une compétence dans
  le profil ne prouve jamais que la personne ne la possède pas.

Le résultat affiche les valeurs qui fondent le constat, la version de la méthode,
une empreinte des seuls champs professionnels utilisés et une référence de
l'offre. Il est calculé à l'affichage : toute modification d'une entrée produit
une nouvelle référence et remplace le résultat devenu obsolète.

## Corpus de régression annoté

`web/src/comparison-evaluation.test.ts` contient quatre scénarios tenus à l'écart
du code des règles, soit douze décisions annotées : concordances explicites,
contradictions de préférences, profil vide et compétence sans preuve dans l'offre.
La livraison exige douze décisions conformes. Ce petit corpus vérifie le contrat
fonctionnel et évite les régressions ; il ne mesure pas la qualité sur la diversité
des CV et offres réels et ne justifie aucun pourcentage présenté aux utilisateurs.

Hermes reste une analyse locale facultative. Avant l'appel, le navigateur et le
serveur retirent les coordonnées et notes personnelles. Le serveur exige des
extraits littéraux des données professionnelles, ignore les critères personnels
et ramène toute conclusion négative sans preuve à `unknown`. La personne doit
toujours relire le résultat.
