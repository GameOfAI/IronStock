/**
 * WebAuthn browser helper — wraps @simplewebauthn/browser for IronStack.
 *
 * Provides two flows:
 *  1. Registration  — addSecurityKey(sessionKey, options) → credential JSON
 *  2. Authentication — authenticateWithKey(sessionKey, options) → credential JSON
 *
 * Both functions return the raw JSON that must be sent to the corresponding
 * finish endpoint along with the session_key.
 *
 * PR-SEC4: ADR-covered by PR-SEC4 plan section.
 */

import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/types';

/**
 * Begin WebAuthn registration and return the raw authenticator response JSON.
 * Throws if the user cancels or if an error occurs.
 */
export async function registerSecurityKey(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<string> {
  const result = await startRegistration({ optionsJSON: options });
  return JSON.stringify(result);
}

/**
 * Begin WebAuthn authentication and return the raw authenticator response JSON.
 * Throws if the user cancels or if an error occurs.
 */
export async function authenticateWithKey(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<string> {
  const result = await startAuthentication({ optionsJSON: options });
  return JSON.stringify(result);
}

/**
 * Returns true if the current browser supports WebAuthn.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined'
  );
}
