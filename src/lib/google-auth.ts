/**
 * Google Identity Services (GIS) utility module.
 *
 * Uses OAuth2 popup flow for cross-browser compatibility (Firefox, Safari, etc.)
 * Falls back to GIS One Tap if available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoogleUserProfile {
  sub: string;   // Google user ID
  email: string;
  name: string;
  picture: string;
}

/** Result of a successful Google sign-in — profile + raw ID token for server verification */
export interface GoogleSignInResult {
  profile: GoogleUserProfile;
  idToken: string;
}

// Google accounts namespace
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (cfg: IdConfig) => void;
          prompt: (cb?: PromptCallback) => void;
          renderButton: (parent: HTMLElement, opts: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
          revoke: (hint: string, cb: (done: RevocationResponse) => void) => void;
        };
        oauth2: {
          initTokenClient: (cfg: TokenClientConfig) => TokenClient;
        };
      };
    };
  }
}

interface IdConfig {
  client_id: string;
  callback: (response: CredentialResponse) => void;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface CredentialResponse {
  credential: string;
  select_by?: string;
}

type PromptNotification = {
  isNotDisplayed: () => boolean;
  getNotDisplayedReason: () => string;
  isSkippedMoment: () => boolean;
  getSkippedReason: () => string;
  isDismissedMoment: () => boolean;
  getDismissedReason: () => string;
};

type PromptCallback = (notification: PromptNotification) => void;

interface RevocationResponse {
  successful: boolean;
  error?: string;
}

interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: TokenResponse) => void;
  error_callback?: (response: { error: string }) => void;
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// GIS script loader (idempotent)
// ---------------------------------------------------------------------------

let gisLoadPromise: Promise<void> | null = null;

/**
 * Dynamically load the Google Identity Services script.
 * Safe to call multiple times — returns the same promise.
 */
export function loadGoogleGIS(): Promise<void> {
  if (gisLoadPromise) return gisLoadPromise;

  // Already loaded?
  if (typeof window !== 'undefined' && window.google?.accounts) {
    return Promise.resolve();
  }

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('google-gis-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Failed to load Google GIS')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gis-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Failed to load Google GIS script'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

// ---------------------------------------------------------------------------
// Sign-in: OAuth2 popup (works on all browsers)
// ---------------------------------------------------------------------------

/**
 * Trigger Google Sign-In using OAuth2 popup flow.
 * Compatible with Firefox, Safari, and browsers with strict cookie policies.
 * Returns the decoded user profile from the JWT id_token.
 */
export function googleSignIn(clientId: string): Promise<GoogleSignInResult> {
  return new Promise<GoogleSignInResult>(async (resolve, reject) => {
    try {
      await loadGoogleGIS();
    } catch {
      reject(new Error('Could not load Google sign-in. Please check your ad blocker settings.'));
      return;
    }

    if (!window.google?.accounts) {
      reject(new Error('Google Identity Services not available'));
      return;
    }

    // Try OAuth2 popup flow first (works everywhere)
    if (window.google.accounts.oauth2) {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        callback: async (response: TokenResponse) => {
          if (response.error) {
            reject(new Error(`Google sign-in failed: ${response.error}`));
            return;
          }
          const token = response.id_token || response.access_token;
          if (!token) {
            reject(new Error('No token returned from Google'));
            return;
          }

          // If we got an id_token, use it directly
          if (response.id_token) {
            try {
              const profile = decodeJwt(response.id_token);
              resolve({ profile, idToken: response.id_token });
            } catch (err) {
              reject(err);
            }
            return;
          }

          // If we only got access_token, fetch userinfo from Google
          try {
            const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${response.access_token}` },
            });
            if (!resp.ok) throw new Error('Failed to fetch Google user info');
            const userInfo = await resp.json();
            const profile: GoogleUserProfile = {
              sub: userInfo.sub,
              email: userInfo.email,
              name: userInfo.name,
              picture: userInfo.picture,
            };
            // Pass access_token as the token for backend verification
            resolve({ profile, idToken: response.access_token! });
          } catch (err) {
            reject(err);
          }
        },
        error_callback: (err) => {
          reject(new Error(`Google sign-in error: ${err.error}`));
        },
      });

      tokenClient.requestAccessToken();
      return;
    }

    // Fallback: GIS One Tap (may not work on Firefox/Safari)
    if (window.google.accounts.id) {
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response: CredentialResponse) => {
          try {
            const profile = decodeJwt(response.credential);
            resolve({ profile, idToken: response.credential });
          } catch (err) {
            reject(err);
          }
        },
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          reject(new Error(`Google sign-in not available: ${notification.getNotDisplayedReason?.() || notification.getSkippedReason?.()}`));
        }
        if (notification.isDismissedMoment()) {
          reject(new Error('Google sign-in was dismissed'));
        }
      });
      return;
    }

    reject(new Error('No Google sign-in method available'));
  });
}

// ---------------------------------------------------------------------------
// JWT decode (no library)
// ---------------------------------------------------------------------------

/**
 * Decode a JWT token's payload and return the Google user profile.
 * Only decodes the payload — does NOT verify the signature.
 * Verification is handled by Google's backend.
 */
export function decodeJwt(token: string): GoogleUserProfile {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts');
  }

  const payload = JSON.parse(atob(parts[1]));

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };
}
