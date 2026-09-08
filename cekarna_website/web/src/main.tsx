import { StrictMode } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/dm-sans';
import App from './App';
import Account from './Account';
import Auth from './Auth';
import Landing from './Landing';
import Legal from './Legal';
import PasswordReset from './PasswordReset';
import Recover from './Recover';
import VerifyEmail from './VerifyEmail';
import './style.css';

const path = window.location.pathname.replace(/\/$/, '') || '/';
const params = new URLSearchParams(window.location.search);
const isCandidateSpace =
  path === '/app' || params.get('workspace') === 'candidate';

let screen: ReactElement;
if (path === '/inscription') screen = <Auth mode="signup" />;
else if (path === '/connexion') screen = <Auth mode="login" />;
else if (path === '/mot-de-passe-oublie') screen = <Recover />;
else if (path === '/reinitialiser') screen = <PasswordReset />;
else if (path === '/verifier-email') screen = <VerifyEmail />;
else if (path === '/compte' || path === '/app/securite') screen = <Account />;
else if (path === '/mentions-legales') screen = <Legal page="legal" />;
else if (path === '/confidentialite') screen = <Legal page="privacy" />;
else if (path === '/cookies') screen = <Legal page="cookies" />;
else if (path === '/cgu') screen = <Legal page="terms" />;
else screen = isCandidateSpace ? <App /> : <Landing />;

createRoot(document.getElementById('root')!).render(
  <StrictMode>{screen}</StrictMode>,
);
