import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, KeyRound, LogOut, ShieldAlert, Trash2, UserRound } from 'lucide-react';
import {
  AuthError,
  bootstrapAuth,
  deleteAccount,
  describeAuthError,
  fetchAccount,
  logout,
  logoutAll,
  type Account as AccountData,
} from './auth-api';
import { STORAGE_KEY } from './domain';

function leave(path: string) {
  window.location.assign(path);
}

export default function Account() {
  const [account, setAccount] = useState<AccountData | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'logout' | 'all' | 'delete' | ''>('');

  useEffect(() => {
    document.title = 'Mon compte — Cekarna';
    bootstrapAuth()
      .then(fetchAccount)
      .then(setAccount)
      .catch(() => leave('/connexion'));
  }, []);

  async function signOut() {
    setBusy('logout');
    try {
      await logout();
      leave('/connexion');
    } catch (error) {
      setMessage(describeAuthError(error));
    } finally {
      setBusy('');
    }
  }
  async function signOutEverywhere() {
    if (!window.confirm('Déconnecter tous vos appareils, y compris celui-ci ?')) return;
    setBusy('all');
    try {
      await logoutAll();
      leave('/connexion');
    } catch (error) {
      setMessage(describeAuthError(error));
    } finally {
      setBusy('');
    }
  }
  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const confirmation = String(form.get('confirmation') ?? '');
    const password = String(form.get('password') ?? '');
    if (confirmation !== 'SUPPRIMER') {
      setMessage('Saisissez SUPPRIMER pour confirmer la suppression.');
      return;
    }
    setBusy('delete');
    setMessage('');
    try {
      await deleteAccount(password);
      localStorage.removeItem(STORAGE_KEY);
      leave('/');
    } catch (error) {
      if (error instanceof AuthError && error.status === 401) {
        setMessage('Votre mot de passe est incorrect.');
      } else {
        setMessage(describeAuthError(error));
      }
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="auth-page account-page">
      <header className="auth-header">
        <a className="landing-brand" href="/" aria-label="Accueil Cekarna">
          <span className="landing-brand-icon"><UserRound size={20} /></span>
          cekarna<span>.</span>
        </a>
        <a className="auth-back" href="/app"><ArrowLeft size={16} /> Retour à mon espace</a>
      </header>
      <main className="account-main">
        <section className="account-heading">
          <p className="landing-kicker"><span /> MON COMPTE</p>
          <h1>Gérer mon accès et mes données.</h1>
          {account && <p>{account.email}{account.email_verified ? ' · adresse confirmée' : ' · adresse à confirmer'}</p>}
        </section>
        {message && <p className="account-feedback" role="alert">{message}</p>}
        <section className="account-card">
          <div><KeyRound size={20} /><div><h2>Session actuelle</h2><p>Fermez la session sur cet appareil.</p></div></div>
          <button className="button secondary" onClick={signOut} disabled={busy !== ''}>
            {busy === 'logout' ? 'Déconnexion…' : 'Se déconnecter'} <LogOut size={16} />
          </button>
        </section>
        <section className="account-card">
          <div><ShieldAlert size={20} /><div><h2>Tous vos appareils</h2><p>Révoquez toutes les sessions actives si un appareil n’est plus sous votre contrôle.</p></div></div>
          <button className="button secondary" onClick={signOutEverywhere} disabled={busy !== ''}>
            {busy === 'all' ? 'Déconnexion…' : 'Déconnecter tous les appareils'}
          </button>
        </section>
        <section className="account-card danger-card">
          <div><Trash2 size={20} /><div><h2>Supprimer mon compte</h2><p>Votre profil, vos offres, vos notes et vos sessions seront définitivement supprimés.</p></div></div>
          <form className="account-delete" onSubmit={remove}>
            <label>Pour confirmer, saisissez SUPPRIMER<input name="confirmation" autoComplete="off" /></label>
            <label>Votre mot de passe<input name="password" type="password" autoComplete="current-password" maxLength={128} required /></label>
            <button className="button danger" type="submit" disabled={busy !== ''}>
              {busy === 'delete' ? 'Suppression…' : 'Supprimer définitivement mon compte'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
