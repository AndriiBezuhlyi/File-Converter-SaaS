import { z } from 'zod';
import { emailSchema, newPassword } from '../../auth/lib/auth-validation';

export const confirmationPassword = z.string().min(1, 'Введіть поточний пароль.');
export const profileSchema = z.object({
  displayName: z.string().trim().max(80, 'Не більше 80 символів.'),
  email: emailSchema,
  currentPassword: confirmationPassword,
});
export const changePasswordSchema = z
  .object({
    currentPassword: confirmationPassword,
    newPassword,
    confirmation: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ['confirmation'],
    error: 'Паролі не збігаються.',
  });
