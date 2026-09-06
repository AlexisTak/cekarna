// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, confirmPasswordReset } from './auth-api';
import PasswordReset from './PasswordReset';

vi.mock('./auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth-api')>();
  return {
    ...actual,
    confirmPasswordReset: vi.fn(),
  };
});

const confirmMock = vi.mocked(confirmPasswordReset);
const roots: Root[] = [];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPage(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

async function submitForm(container: HTMLElement, values: Record<string, string>) {
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  for (const [name, value] of Object.entries(values)) {
    const field = form!.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    expect(field).not.toBeNull();
    field!.value = value;
  }
  await act(async () => form!.requestSubmit());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('PasswordReset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  afterEach(async () => {
    while (roots.length) {
      const root = roots.pop();
      if (root) await act(async () => root.unmount());
    }
    document.body.innerHTML = '';
  });

  it('shows an error and disables the form when the token is missing', async () => {
    window.history.replaceState(null, '', '/reinitialiser');
    const container = await renderPage(<PasswordReset />);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Ce lien de récupération est incomplet.');
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled,
    ).toBe(true);
  });

  it('rejects passwords shorter than 15 characters without calling the API', async () => {
    window.history.replaceState(null, '', '/reinitialiser?token=tok-9');
    const container = await renderPage(<PasswordReset />);
    await submitForm(container, { password: 'trop-court' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Utilisez au moins 15 caractères.',
    );
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('confirms the reset and links back to the connexion page', async () => {
    window.history.replaceState(null, '', '/reinitialiser?token=tok-9');
    confirmMock.mockResolvedValue(undefined);
    const container = await renderPage(<PasswordReset />);
    const password = 'x'.repeat(16);
    await submitForm(container, { password });
    expect(confirmMock).toHaveBeenCalledWith('tok-9', password);
    expect(container.textContent).toContain('Mot de passe enregistré.');
    const link = container.querySelector('a[href="/connexion"]');
    expect(link).not.toBeNull();
  });

  it('renders the expired-link message on a 401 from the API', async () => {
    window.history.replaceState(null, '', '/reinitialiser?token=tok-9');
    confirmMock.mockRejectedValue(new AuthError(401, 'reset_invalid'));
    const container = await renderPage(<PasswordReset />);
    await submitForm(container, { password: 'y'.repeat(16) });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Ce lien est expiré ou déjà utilisé. Demandez un nouveau lien.',
    );
  });
});
