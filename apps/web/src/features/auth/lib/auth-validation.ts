import { z } from 'zod';

export type CredentialsMode = 'login' | 'register' | 'reset';
export const emailSchema = z.string().trim().pipe(z.email('Вкажіть коректну електронну пошту.'));
// Provisional UI limits, not a server password policy. Do not trim or transform passwords.
const newPassword = z.string().min(8, 'Щонайменше 8 символів.').max(128, 'Не більше 128 символів.');
export const emailFormSchema = z.object({ email: emailSchema });
export function credentialsSchema(mode: CredentialsMode) {
  return z
    .object({
      email: mode === 'reset' ? z.string() : emailSchema,
      password: mode === 'login' ? z.string().min(1, 'Введіть пароль.') : newPassword,
      confirmation: z.string(),
    })
    .refine((data) => mode === 'login' || data.password === data.confirmation, {
      path: ['confirmation'],
      error: 'Паролі не збігаються.',
    });
}

export function safeReturnTo(value: string | null): string {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    return '/';
  const url = new URL(value, 'https://converter.invalid');
  if (
    url.origin !== 'https://converter.invalid' ||
    !['/', '/account', '/files'].includes(url.pathname)
  )
    return '/';
  const id = url.searchParams.get('conversion');
  return url.pathname === '/' && id && /^[a-zA-Z0-9_-]{1,128}$/.test(id)
    ? `/?conversion=${encodeURIComponent(id)}`
    : url.pathname;
}
export function authHref(path: string, returnTo: string) {
  return returnTo === '/' ? path : `${path}?returnTo=${encodeURIComponent(returnTo)}`;
}
