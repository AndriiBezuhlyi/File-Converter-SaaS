import { z } from 'zod';
import { emailSchema } from '../../auth/lib/auth-validation';

export const confirmationPassword = z.string().min(1, 'Введіть поточний пароль.');
export const profileSchema = z.object({
  displayName: z.string().trim().max(80, 'Не більше 80 символів.'),
  email: emailSchema,
  currentPassword: confirmationPassword,
});
export const changePasswordSchema = z
  .object({
    currentPassword: confirmationPassword,
    newPassword: z.string().min(8, 'Щонайменше 8 символів.').max(128, 'Не більше 128 символів.'),
    confirmation: z.string(),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ['confirmation'],
    error: 'Паролі не збігаються.',
  });
