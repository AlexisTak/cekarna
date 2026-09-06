// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmEmailVerification } from './auth-api';
import VerifyEmail from './VerifyEmail';

vi.mock('./auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth-api')>();
  return {
    ...actual,
    confirmEmailVerification: vi.fn(),
  };
});

const confirmMock = vi.mocked(confirmEmailVerification);
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

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('VerifyEmail', () => {
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

  it('confirms the token once under StrictMode and shows the success message', async () => {
    window.history.replaceState(null, '', '/verifier-email?token=tok-42');
    confirmMock.mockResolvedValue(undefined);
    const container = await renderPage(
      <StrictMode>
        <VerifyEmail />
      </StrictMode>,
    );
    await flush();
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(confirmMock).toHaveBeenCalledWith('tok-42');
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(container.textContent).toContain(
      'Votre adresse est confirmée. Merci ! Vous pouvez fermer cet onglet.',
    );
  });

  it('shows a generic error when the token is missing', async () => {
    window.history.replaceState(null, '', '/verifier-email');
    const container = await renderPage(<VerifyEmail />);
    await flush();
    expect(confirmMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      'Ce lien est invalide, expiré ou déjà utilisé.',
    );
    expect(container.querySelector('a[href="/connexion"]')).not.toBeNull();
  });

  it('shows a generic error when confirmation fails', async () => {
    window.history.replaceState(null, '', '/verifier-email?token=tok-dead');
    confirmMock.mockRejectedValue(new Error('boom'));
    const container = await renderPage(<VerifyEmail />);
    await flush();
    expect(container.textContent).toContain(
      'Ce lien est invalide, expiré ou déjà utilisé.',
    );
    expect(container.textContent).not.toContain('Vérification en cours');
  });
});
