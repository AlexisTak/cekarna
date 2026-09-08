import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasskey, getPasskey } from './webauthn';

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe('WebAuthn browser adapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('decodes creation options and serializes the attestation', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'credential', rawId: bytes(1, 2), type: 'public-key', authenticatorAttachment: 'platform',
      getClientExtensionResults: () => ({}),
      response: { clientDataJSON: bytes(3), attestationObject: bytes(4), getTransports: () => ['internal'] },
    });
    vi.stubGlobal('navigator', { credentials: { create } });
    const result = await createPasskey({ publicKey: { challenge: 'AQI', user: { id: 'Aw', name: 'u', displayName: 'U' }, pubKeyCredParams: [] } });
    const options = create.mock.calls[0][0].publicKey;
    expect(Array.from(new Uint8Array(options.challenge))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(options.user.id))).toEqual([3]);
    expect(result).toMatchObject({ rawId: 'AQI', response: { clientDataJSON: 'Aw', attestationObject: 'BA', transports: ['internal'] } });
  });

  it('serializes an assertion and treats user cancellation silently', async () => {
    const get = vi.fn().mockResolvedValue({
      id: 'credential', rawId: bytes(1), type: 'public-key', authenticatorAttachment: null,
      getClientExtensionResults: () => ({}),
      response: { clientDataJSON: bytes(2), authenticatorData: bytes(3), signature: bytes(4), userHandle: null },
    });
    vi.stubGlobal('navigator', { credentials: { get } });
    await expect(getPasskey({ publicKey: { challenge: 'AQ', allowCredentials: [{ id: 'Ag', type: 'public-key' }] } })).resolves.toMatchObject({ response: { signature: 'BA', userHandle: null } });
    get.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'));
    await expect(getPasskey({ publicKey: { challenge: 'AQ' } })).resolves.toBeNull();
  });
});
