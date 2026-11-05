import { AuthError } from '../auth-error.js';

export const invalidGuest = () =>
  new AuthError(
    401,
    'GUEST_CREDENTIAL_INVALID',
    'Guest access is invalid or too close to expiry. Please sign in to continue.',
  );
export const guestConflict = () =>
  new AuthError(
    409,
    'GUEST_STATE_CONFLICT',
    'Guest conversion state changed. Refresh and try again.',
  );
