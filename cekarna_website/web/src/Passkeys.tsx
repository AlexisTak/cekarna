import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import {
  AuthError,
  beginPasskeyEnrollment,
  deletePasskey,
  finishPasskeyEnrollment,
  listPasskeys,
  type PasskeySummary,
} from './auth-api';
import { createPasskey, supportsPasskeys } from './webauthn';

const date = (value?: string) =>
  value ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' }).format(new Date(value)) : 'jamais';

export function Passkeys({ active }: { active: boolean }) {
  const [items, setItems] = useState<PasskeySummary[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const supported = supportsPasskeys();
  async function refresh() {
    setItems(await listPasskeys());
  }
  useEffect(() => {
    if (active) void refresh().catch(() => setMessage('Impossible de charger vos passkeys.'));
  }, [active]);

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const password = String(form.get('password') ?? '');
    if (!name || !password) { setMessage('Indiquez un nom et votre mot de passe actuel.'); return; }
    setBusy(true); setMessage('');
    try {
      const ceremony = await beginPasskeyEnrollment(password);
      const credential = await createPasskey(ceremony.options);
      if (!credential) return;
      await finishPasskeyEnrollment(ceremony.challenge_id, name, credential);
      event.currentTarget.reset();
      await refresh();
      setMessage('Passkey ajoutée. Elle sera demandée lors de votre prochaine connexion.');
    } catch (error) {
      setMessage(error instanceof AuthError && error.status === 401 ? 'Votre mot de passe actuel est incorrect.' : 'La passkey n’a pas pu être ajoutée.');
    } finally { setBusy(false); }
  }

  async function remove(item: PasskeySummary) {
    if (!window.confirm(`Supprimer la passkey « ${item.name} » ?`)) return;
    setBusy(true); setMessage('');
    try { await deletePasskey(item.id); await refresh(); setMessage('Passkey supprimée.'); }
    catch { setMessage('La passkey n’a pas pu être supprimée.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="account-card passkey-card">
      <div><KeyRound size={20} /><div><h2>Passkeys</h2><p>Ajoutez Windows Hello, un téléphone ou une clé de sécurité comme second facteur.</p></div></div>
      <div className="passkey-content">
        {!supported && <p>Ce navigateur ne prend pas en charge les passkeys. Utilisez un navigateur compatible pour les gérer ; si vous perdez tous vos appareils, passez par la récupération du compte.</p>}
        {items.length > 0 && <ul className="passkey-list">{items.map((item) => (
          <li key={item.id}><span><strong>{item.name}</strong><small>Ajoutée le {date(item.created_at)} · dernière utilisation : {date(item.last_used_at)}</small></span><button className="button secondary" onClick={() => void remove(item)} disabled={busy} aria-label={`Supprimer ${item.name}`}><Trash2 size={15} /> Supprimer</button></li>
        ))}</ul>}
        {supported && <form className="passkey-form" onSubmit={enroll}>
          <label>Nom de la passkey<input name="name" maxLength={80} placeholder="Windows Hello" required /></label>
          <label>Mot de passe actuel<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
          <button className="button primary" disabled={busy}>{busy ? 'Ajout…' : 'Ajouter une passkey'}</button>
        </form>}
        <p className="passkey-recovery">En cas de perte de tous vos appareils, la récupération par email et le changement du mot de passe supprimeront toutes les passkeys.</p>
        {message && <p className="account-feedback" role="status">{message}</p>}
      </div>
    </section>
  );
}
