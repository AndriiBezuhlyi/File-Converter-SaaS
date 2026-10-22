export const authRoutes = [
  { path: '/login', kind: 'login', title: 'Увійти' },
  { path: '/register', kind: 'register', title: 'Створити акаунт' },
  { path: '/verify-email', kind: 'verify-email', title: 'Підтвердження пошти' },
  { path: '/forgot-password', kind: 'forgot-password', title: 'Відновлення пароля' },
  { path: '/reset-password', kind: 'reset-password', title: 'Новий пароль' },
] as const;
export const routePreviews = [
  { path: '/account', title: 'Профіль', description: 'Особистий кабінет ще готується.' },
  { path: '/files', title: 'Мої файли', description: 'Розділ збережених файлів ще готується.' },
] as const;

export function getRouteTitle(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api-docs') return 'Документація API';
  return normalizedPath === '/'
    ? 'Конвертер файлів'
    : ([...authRoutes, ...routePreviews].find((route) => route.path === normalizedPath)?.title ??
        'Сторінку не знайдено');
}
