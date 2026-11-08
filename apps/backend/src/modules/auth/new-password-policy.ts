// Curated local baseline v1: common/expected secrets, not comprehensive breach detection.
// Update both policy copies through reviewed commits; parity is regression-tested.
// Screening is case-insensitive. Hashing receives the original, unmodified password.
const commonPasswords = new Set([
  '1234567890',
  '12345678901',
  '123456789012',
  '123456789012345',
  '0123456789',
  '0987654321',
  'password12',
  'password123',
  'password1234',
  'password12345',
  'password123456',
  'password123456789',
  'password123!',
  'password1!',
  'password!1',
  'password01',
  '123456789a',
  'abc1234567',
  '1qaz2wsx3e',
  'password1234!',
  'password12345!',
  'password123456!',
  'qwerty12345',
  'qwerty123456',
  'qwertyuiop',
  'qwertyuiop123',
  'qwertyuiopasdfgh',
  'iloveyou123',
  'letmein1234',
  'admin12345',
  'administrator',
  'welcome123',
  'welcome1234',
  'welcome123!',
  'changeme123',
  'changeme123!',
  'пароль12345',
  'пароль123456',
  'fluxconverter',
  'flux converter',
  'flux-converter',
  'flux_converter',
  'clarityconverter',
  'fileconverter',
  'file converter',
]);
export function newPasswordIssue(value: unknown): 'length' | 'common' | null {
  // Bound work before code-point iteration; 128 code points use at most 256 UTF-16 units.
  if (typeof value !== 'string' || value.length > 256) return 'length';
  const length = Array.from(value).length;
  if (length < 10 || length > 128) return 'length';
  const candidate = value.toLowerCase();
  if (
    commonPasswords.has(candidate) ||
    /^(?:flux[ _-]?converter|clarity[ _-]?converter|file[ _-]?converter)(?:[0-9]{1,8}[!@#?]?|[!@#?])?$/.test(
      candidate,
    )
  )
    return 'common';
  return null;
}
