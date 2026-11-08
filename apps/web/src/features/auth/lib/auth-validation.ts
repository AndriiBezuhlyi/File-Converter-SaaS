import { z } from 'zod';
import { newPasswordIssue } from './new-password-policy';

export type CredentialsMode = 'login' | 'register' | 'reset';
export const emailSchema = z.string().trim().pipe(z.email('Вкажіть коректну електронну пошту.'));
// Match the agreed server policy without trimming or transforming passwords.
export const newPassword = z.string().superRefine((value, context) => {
  const issue = newPasswordIssue(value);
  if (issue)
    context.addIssue({
      code: 'custom',
      message:
        issue === 'length'
          ? 'Від 10 до 128 символів (Unicode).'
          : 'Цей пароль надто поширений або передбачуваний. Оберіть інший, наприклад довгу фразу.',
    });
});
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
