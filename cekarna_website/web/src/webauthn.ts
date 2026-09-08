function decode(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer | null): string | null {
  if (!value) return null;
  const bytes = new Uint8Array(value);
  let binary = '';
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function publicKey(options: Record<string, unknown>, creation: boolean): PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions {
  const wrapper = (options.publicKey ?? options) as Record<string, unknown>;
  const converted = { ...wrapper, challenge: decode(String(wrapper.challenge)) } as Record<string, unknown>;
  if (creation) {
    const user = wrapper.user as Record<string, unknown>;
    converted.user = { ...user, id: decode(String(user.id)) };
    converted.excludeCredentials = ((wrapper.excludeCredentials as Record<string, unknown>[] | undefined) ?? []).map((item) => ({ ...item, id: decode(String(item.id)) }));
  } else {
    converted.allowCredentials = ((wrapper.allowCredentials as Record<string, unknown>[] | undefined) ?? []).map((item) => ({ ...item, id: decode(String(item.id)) }));
  }
  return converted as unknown as PublicKeyCredentialCreationOptions | PublicKeyCredentialRequestOptions;
}

function common(credential: PublicKeyCredential) {
  return {
    id: credential.id,
    rawId: encode(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
}

export function supportsPasskeys(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && Boolean(navigator.credentials);
}

export async function createPasskey(options: Record<string, unknown>): Promise<unknown | null> {
  try {
    const credential = (await navigator.credentials.create({ publicKey: publicKey(options, true) as PublicKeyCredentialCreationOptions })) as PublicKeyCredential | null;
    if (!credential) return null;
    const response = credential.response as AuthenticatorAttestationResponse;
    return { ...common(credential), response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject), transports: response.getTransports?.() ?? [] } };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return null;
    throw error;
  }
}

export async function getPasskey(options: Record<string, unknown>): Promise<unknown | null> {
  try {
    const credential = (await navigator.credentials.get({ publicKey: publicKey(options, false) as PublicKeyCredentialRequestOptions })) as PublicKeyCredential | null;
    if (!credential) return null;
    const response = credential.response as AuthenticatorAssertionResponse;
    return { ...common(credential), response: { clientDataJSON: encode(response.clientDataJSON), authenticatorData: encode(response.authenticatorData), signature: encode(response.signature), userHandle: encode(response.userHandle) } };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return null;
    throw error;
  }
}
