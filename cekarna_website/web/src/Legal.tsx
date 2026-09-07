const contact =
  (import.meta.env.VITE_LEGAL_CONTACT as string | undefined) ||
  'À compléter avant publication';
const publisher =
  (import.meta.env.VITE_LEGAL_PUBLISHER as string | undefined) ||
  'À compléter avant publication';

export default function Legal({
  page,
}: {
  page: 'legal' | 'privacy' | 'cookies' | 'terms';
}) {
  const content = {
    legal: [
      'Mentions légales',
      <>
        Éditeur : {publisher}. Contact : {contact}. Les coordonnées complètes de
        l’éditeur, de l’hébergeur et, le cas échéant, les informations
        d’immatriculation doivent être renseignées avant toute publication.
      </>,
    ],
    privacy: [
      'Politique de confidentialité',
      <>
        Cekarna traite les données de compte, le dossier candidat et les CV
        importés afin de fournir l’espace de recherche d’emploi, la sécurité des
        accès et la synchronisation choisie. Vous pouvez demander l’accès, la
        rectification, l’effacement, la limitation, l’opposition ou la
        portabilité en écrivant à {contact}. Vous pouvez également saisir la
        CNIL. Les données ne sont pas vendues ; aucun CV n’est transmis à un
        recruteur.
      </>,
    ],
    cookies: [
      'Cookies',
      <>
        Cekarna utilise des traceurs strictement nécessaires à
        l’authentification et à la sécurité. Aucun cookie publicitaire, réseau
        social ou mesure d’audience non exemptée n’est activé dans cette
        version. Si cela change, un choix accepter/refuser de même simplicité
        sera proposé avant leur dépôt.
      </>,
    ],
    terms: [
      'Conditions générales d’utilisation',
      <>
        Cekarna aide une personne à organiser sa recherche d’emploi. Les
        informations restent sous son contrôle ; aucune candidature n’est
        envoyée automatiquement. Le service ne garantit ni l’exactitude d’une
        offre externe ni l’obtention d’un emploi. L’utilisation doit respecter
        la loi et les droits des tiers.
      </>,
    ],
  }[page];
  return (
    <main className="legal-page">
      <a href="/">← Retour à l’accueil</a>
      <h1>{content[0]}</h1>
      <p>{content[1]}</p>
      <p>Dernière mise à jour : 7 septembre 2026.</p>
    </main>
  );
}
