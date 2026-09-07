# Cekarna Admin

Application Tauri séparée de l’interface web candidat. Elle sert à observer, depuis un poste local de confiance, si les services nécessaires au développement répondent sur leur port local.

Elle ne donne accès à aucun CV, profil candidat, jeton, secret ou écran de l’application web. Les appels de santé et les commandes sont réalisés par le processus Rust Tauri, ce qui évite d’ouvrir une route d’administration ou d’assouplir les règles CORS du site public.

## Démarrer

Prérequis : Node.js, Rust et les dépendances système Tauri pour Windows.

```powershell
cd desktop-admin
npm install
npm run tauri:dev
```

## Construire

```powershell
npm run tauri:build
```

Le premier écran vérifie les adresses de bouclage de l’API candidat, de l’identité, des notifications et d’Ollama. Il peut démarrer et arrêter les services Docker Cekarna `auth` et `notifications`, sans supprimer leurs volumes. Il peut aussi démarrer l’API candidat ou Ollama ; il n’arrête ces deux processus que lorsqu’ils ont été créés depuis le panneau. Une réponse indisponible ne donne pas de diagnostic : consulter les journaux du service concerné avant toute intervention.

Les futures actions d’exploitation devront être ajoutées au cas par cas avec une authentification d’opérateur, une autorisation explicite et une journalisation adaptée. Elles ne doivent jamais être ajoutées à l’application web B2C.
