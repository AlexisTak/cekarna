// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { emptyWorkspace, STORAGE_KEY } from './domain';
import { fetchCandidateWorkspace } from './auth-api';

vi.mock('./auth-api', async (original) => ({
  ...await original<typeof import('./auth-api')>(),
  bootstrapAuth: vi.fn().mockResolvedValue(undefined),
  fetchAccount: vi.fn().mockResolvedValue({ id: 'user-b', first_name: 'Alexis', email_verified: true }),
  fetchCandidateWorkspace: vi.fn(),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('stores an authenticated dossier under its account without overwriting the guest workspace', async () => {
  const guest = emptyWorkspace();
  guest.profile.firstName = 'Invité';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(guest));
  const personal = emptyWorkspace();
  personal.profile.firstName = 'Alexis';
  vi.mocked(fetchCandidateWorkspace).mockResolvedValue({ workspace: personal, revision: 0 });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(guest);
    expect(JSON.parse(localStorage.getItem(`${STORAGE_KEY}.account.user-b`)!)).toEqual(personal);
    expect(container.textContent).toContain('Alexis');
  } finally { await act(async () => root.unmount()); }
});

it('still displays the server profile when the browser refuses local storage writes', async () => {
  const personal = emptyWorkspace();
  personal.profile.firstName = 'Alexis';
  vi.mocked(fetchCandidateWorkspace).mockResolvedValue({ workspace: personal, revision: 0 });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<App />));
    expect(container.textContent).toContain('Alexis');
    expect(container.textContent).toContain('La copie locale ne peut pas');
  } finally { await act(async () => root.unmount()); }
});
