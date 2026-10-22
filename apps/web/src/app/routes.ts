export const authRoutes = [
  { path: '/login', kind: 'login', title: 'Увійти' },
  { path: '/register', kind: 'register', title: 'Створити акаунт' },
  { path: '/verify-email', kind: 'verify-email', title: 'Підтвердження пошти' },
  { path: '/forgot-password', kind: 'forgot-password', title: 'Відновлення пароля' },
  { path: '/reset-password', kind: 'reset-password', title: 'Новий пароль' },
] as const;

export function getRouteTitle(pathname: string) {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  if (normalizedPath === '/api-docs') return 'Документація API';
  if (normalizedPath === '/account') return 'Профіль';
  if (normalizedPath === '/files') return 'Мої файли';
  return normalizedPath === '/'
    ? 'Конвертер файлів'
    : (authRoutes.find((route) => route.path === normalizedPath)?.title ?? 'Сторінку не знайдено');
}
