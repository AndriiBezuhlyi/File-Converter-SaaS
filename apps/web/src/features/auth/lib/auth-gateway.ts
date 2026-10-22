// Frontend view models only; item 8 maps the finalized HTTP contract to this port.
export type AuthSession = { kind: 'anonymous' } | { kind: 'authenticated'; email: string };
export interface Credentials {
  email: string;
  password: string;
}
export interface AuthGateway {
  readonly scope: string;
  readSession(signal: AbortSignal): Promise<AuthSession>;
  register(credentials: Credentials): Promise<void>;
  signIn(credentials: Credentials): Promise<'signed-in' | 'verification-required'>;
  signOut(): Promise<void>;
  resendVerification(email: string): Promise<void>;
  verifyEmail(token: string): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
}
export class AuthRequestError extends Error {
  constructor(
    readonly kind:
      | 'unavailable'
      | 'network'
      | 'invalid-credentials'
      | 'invalid-token'
      | 'rate-limited'
      | 'rejected',
  ) {
    super('Authentication request could not be completed.');
    this.name = 'AuthRequestError';
  }
}
export function authErrorMessage(error: unknown) {
  const kind = error instanceof AuthRequestError ? error.kind : 'rejected';
  return {
    unavailable: 'Авторизацію ще не підключено. Дані нікуди не надіслано.',
    network: 'Не вдалося отримати відповідь. Перевірте з’єднання та спробуйте ще раз.',
    'invalid-credentials': 'Не вдалося увійти. Перевірте пошту та пароль.',
    'invalid-token': 'Посилання недійсне або строк його дії минув. Запросіть нове.',
    'rate-limited': 'Забагато спроб. Зачекайте перед наступною спробою.',
    rejected: 'Не вдалося виконати дію. Спробуйте ще раз пізніше.',
  }[kind];
}
