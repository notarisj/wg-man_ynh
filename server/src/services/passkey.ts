import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from '@simplewebauthn/server/esm/types/index';

const DATA_DIR   = process.env.WG_DATA_DIR    || '/var/lib/wg-man';
const STORE_FILE = path.join(DATA_DIR, 'passkeys.json');
const RP_ID      = process.env.PASSKEY_RP_ID     || 'localhost';
const RP_NAME    = process.env.PASSKEY_RP_NAME   || 'WG Manager';
const RP_ORIGIN  = process.env.PASSKEY_RP_ORIGIN || 'http://localhost:5173';

// ── Storage ──────────────────────────────────────────────────

export type StoredCredential = {
  id: string;           // Base64URLString credential ID
  publicKey: number[];  // Uint8Array serialised as number array
  counter: number;
  transports?: string[];
  registeredAt: number; // unix ms
};

type Store = {
  credentials: StoredCredential[];
  /**
   * When true, new passkey registrations are blocked from the UI.
   * Can only be set back to false by editing this file on the server via SSH.
   */
  registrationLocked: boolean;
};

let _store: Store | null = null;

/**
 * In-memory generation counter — incremented every time credentials are wiped.
 * Sessions stamp the generation at verification time; requirePasskey rejects
 * sessions whose generation is stale (i.e. credentials were reset after auth).
 * Resets to 0 on server restart, which is fine — MemoryStore sessions don't
 * survive restarts either.
 */
let _generation = 0;
export function getGeneration(): number { return _generation; }

async function loadStore(): Promise<Store> {
  if (_store) return _store;
  try {
    const raw = await readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    _store = { registrationLocked: false, ...parsed };
  } catch {
    _store = { credentials: [], registrationLocked: false };
  }
  return _store!;
}

async function saveStore(store: Store): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  _store = store;
}

// ── Public API ───────────────────────────────────────────────

export async function hasPasskey(): Promise<boolean> {
  const store = await loadStore();
  return store.credentials.length > 0;
}

export async function isRegistrationLocked(): Promise<boolean> {
  const store = await loadStore();
  return store.registrationLocked;
}

export async function getStatus(): Promise<{
  registered: boolean;
  registrationLocked: boolean;
  credentials: Pick<StoredCredential, 'id' | 'registeredAt'>[];
  storeFile: string;
}> {
  const store = await loadStore();
  return {
    registered: store.credentials.length > 0,
    registrationLocked: store.registrationLocked,
    credentials: store.credentials.map(({ id, registeredAt }) => ({ id, registeredAt })),
    storeFile: STORE_FILE,
  };
}

/** Prevent new passkey registrations. Only reversible via SSH. */
export async function lockRegistration(): Promise<void> {
  const store = await loadStore();
  store.registrationLocked = true;
  await saveStore(store);
}

export async function startRegistration(): Promise<
  { ok: true; options: Awaited<ReturnType<typeof generateRegistrationOptions>>; challenge: string }
  | { ok: false; locked: true }
> {
  const store = await loadStore();

  if (store.registrationLocked) return { ok: false, locked: true };

  const excludeCredentials = store.credentials.map((c) => ({
    id: c.id,
    transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: 'admin',
    userDisplayName: 'WG Manager Admin',
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  return { ok: true, options, challenge: options.challenge };
}

export async function finishRegistration(
  response: RegistrationResponseJSON,
  expectedChallenge: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // Double-check lock hasn't been applied between start and finish
    const store = await loadStore();
    if (store.registrationLocked) return { ok: false, error: 'Registration is locked' };

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return { ok: false, error: 'Registration verification failed' };
    }

    const { credential } = verification.registrationInfo;

    store.credentials.push({
      id: credential.id,
      publicKey: Array.from(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      registeredAt: Date.now(),
    });

    await saveStore(store);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'Registration failed' };
  }
}

export async function startAuthentication(): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challenge: string;
}> {
  const store = await loadStore();
  const allowCredentials = store.credentials.map((c) => ({
    id: c.id,
    transports: (c.transports ?? []) as AuthenticatorTransportFuture[],
  }));

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  return { options, challenge: options.challenge };
}

export async function finishAuthentication(
  response: AuthenticationResponseJSON,
  expectedChallenge: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const store = await loadStore();
    const cred = store.credentials.find((c) => c.id === response.id);
    if (!cred) return { ok: false, error: 'Unknown credential' };

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.id,
        publicKey: new Uint8Array(cred.publicKey),
        counter: cred.counter,
        transports: (cred.transports ?? []) as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) return { ok: false, error: 'Authentication failed' };

    cred.counter = verification.authenticationInfo.newCounter;
    await saveStore(store);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message ?? 'Authentication failed' };
  }
}

export async function clearPasskeys(): Promise<void> {
  const store = await loadStore();
  store.credentials = [];
  await saveStore(store);
  _generation++; // invalidate all active passkey-verified sessions
}
