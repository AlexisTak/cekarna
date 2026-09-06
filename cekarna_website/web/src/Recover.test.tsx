// @vitest-environment jsdom
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, requestPasswordReset } from './auth-api';
import Recover from './Recover';

vi.mock('./auth-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth-api')>();
  return {
    ...actual,
    requestPasswordReset: vi.fn(),
  };
});

const requestMock = vi.mocked(requestPasswordReset);
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

async function submitEmail(container: HTMLElement, email: string) {
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  const field = form!.querySelector<HTMLInputElement>('input[name="email"]');
  expect(field).not.toBeNull();
  field!.value = email;
  await act(async () => form!.requestSubmit());
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('Recover', () => {
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

  it('rejects a malformed email without calling the API', async () => {
    const container = await renderPage(<Recover />);
    await submitEmail(container, 'pas-une-adresse');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Saisissez une adresse email valide.',
    );
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('shows a neutral confirmation after a successful request', async () => {
    requestMock.mockResolvedValue(undefined);
    const container = await renderPage(<Recover />);
    await submitEmail(container, 'moi@exemple.fr');
    expect(requestMock).toHaveBeenCalledWith('moi@exemple.fr');
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain(
      'Si un compte existe pour cette adresse, un email de récupération a été envoyé.',
    );
  });

  it('surfaces the API error and keeps the form visible', async () => {
    requestMock.mockRejectedValue(new AuthError(429, 'rate_limited'));
    const container = await renderPage(<Recover />);
    await submitEmail(container, 'moi@exemple.fr');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Trop de tentatives. Réessayez dans quelques minutes.',
    );
    expect(container.querySelector('form')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
