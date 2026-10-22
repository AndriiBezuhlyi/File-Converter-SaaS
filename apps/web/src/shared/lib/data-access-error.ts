export class DataAccessError extends Error {
  constructor(
    readonly kind:
      | 'network'
      | 'unauthorized'
      | 'not-found'
      | 'expired'
      | 'confirmation'
      | 'rate-limited'
      | 'rejected',
  ) {
    super('The requested operation could not be completed.');
    this.name = 'DataAccessError';
  }
}
export function dataErrorMessage(cause: unknown): string {
  const kind = cause instanceof DataAccessError ? cause.kind : 'rejected';
  return {
    network: 'Не вдалося отримати відповідь. Перевірте з’єднання та спробуйте ще раз.',
    unauthorized: 'Сесію завершено. Увійдіть до акаунту ще раз.',
    'not-found': 'Дані більше недоступні. Оновіть сторінку.',
    expired: 'Файл більше недоступний для завантаження.',
    confirmation: 'Не вдалося підтвердити особу. Перевірте поточний пароль.',
    'rate-limited': 'Забагато спроб. Зачекайте перед наступною спробою.',
    rejected: 'Не вдалося виконати дію. Спробуйте ще раз пізніше.',
  }[kind];
}
