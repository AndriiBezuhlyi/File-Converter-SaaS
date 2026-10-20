export const routePreviews = [
  { path: '/login', title: 'Увійти', description: 'Вхід до акаунту ще готується.' },
  { path: '/register', title: 'Створити акаунт', description: 'Реєстрація ще готується.' },
  {
    path: '/verify-email',
    title: 'Підтвердження пошти',
    description: 'Підтвердження електронної пошти ще готується.',
  },
  {
    path: '/forgot-password',
    title: 'Відновлення пароля',
    description: 'Відновлення доступу ще готується.',
  },
  { path: '/reset-password', title: 'Новий пароль', description: 'Зміна пароля ще готується.' },
  { path: '/account', title: 'Профіль', description: 'Особистий кабінет ще готується.' },
  { path: '/files', title: 'Мої файли', description: 'Розділ збережених файлів ще готується.' },
] as const;

export function getRouteTitle(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api-docs') return 'Документація API';
  return normalizedPath === '/'
    ? 'Конвертер файлів'
    : (routePreviews.find((route) => route.path === normalizedPath)?.title ??
        'Сторінку не знайдено');
}
