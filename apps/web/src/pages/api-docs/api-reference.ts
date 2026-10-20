// Planned documentation content from technical-task.md / architecture.md.
// These examples are not generated client types or proof of implemented endpoints.
export const sections = [
  { id: 'quick-start', title: 'Швидкий старт' },
  { id: 'authentication', title: 'Авторизація' },
  { id: 'conversions', title: 'Конвертації' },
  { id: 'saved-files', title: 'Збережені файли' },
  { id: 'limits', title: 'Ліміти' },
  { id: 'errors', title: 'Помилки' },
] as const;

export const examples = {
  create: [
    "curl --request POST 'https://api.example.com/api/v1/conversions' \\",
    "  --header 'X-API-Key: YOUR_API_KEY' \\",
    "  --form 'file=@./image.jpg' \\",
    "  --form 'targetFormat=png'",
  ].join('\n'),
  accepted: JSON.stringify(
    {
      id: 'conversion_123',
      status: 'queued',
      sourceFormat: 'jpg',
      targetFormat: 'png',
      createdAt: '2026-10-13T18:00:00Z',
    },
    null,
    2,
  ),
  status: [
    "curl 'https://api.example.com/api/v1/conversions/conversion_123' \\",
    "  --header 'X-API-Key: YOUR_API_KEY'",
  ].join('\n'),
  completed: JSON.stringify(
    {
      id: 'conversion_123',
      status: 'completed',
      downloadUrl: '/api/v1/conversions/conversion_123/download',
      expiresAt: '2026-10-13T19:00:00Z',
    },
    null,
    2,
  ),
  download: [
    "curl --fail 'https://api.example.com/api/v1/conversions/conversion_123/download' \\",
    "  --header 'X-API-Key: YOUR_API_KEY' \\",
    "  --output './result.png'",
  ].join('\n'),
  files: [
    "curl 'https://api.example.com/api/v1/files' \\",
    "  --header 'X-API-Key: YOUR_API_KEY'",
  ].join('\n'),
  error: JSON.stringify(
    {
      error: { code: 'FILE_TOO_LARGE', message: 'The uploaded file exceeds the allowed size.' },
    },
    null,
    2,
  ),
};

export const fileOperations = [
  {
    method: 'GET',
    path: '/api/v1/files',
    description: 'Отримати список збережених файлів свого акаунту.',
  },
  { method: 'GET', path: '/api/v1/files/:id', description: 'Переглянути метадані свого файлу.' },
  {
    method: 'GET',
    path: '/api/v1/files/:id/download',
    description: 'Завантажити свій збережений файл.',
  },
  {
    method: 'DELETE',
    path: '/api/v1/files/:id',
    description:
      'Видалити свій файл. Завантаження блокується одразу, зокрема через задачу конвертації.',
  },
] as const;

export const errors = [
  { status: 400, title: 'Bad Request', description: 'Неправильні параметри запиту.' },
  {
    status: 401,
    title: 'Unauthorized',
    description: 'API-ключ відсутній, недійсний або відкликаний.',
  },
  { status: 403, title: 'Forbidden', description: 'Недостатньо прав для операції.' },
  {
    status: 404,
    title: 'Not Found',
    description: 'Ресурс не існує або недоступний цьому клієнту.',
  },
  {
    status: 409,
    title: 'Conflict',
    description: 'Результат вашої задачі ще не готовий до завантаження.',
  },
  { status: 410, title: 'Gone', description: 'Ваш результат прострочений або видалений.' },
  { status: 413, title: 'Payload Too Large', description: 'Файл перевищує дозволений розмір.' },
  {
    status: 415,
    title: 'Unsupported Media Type',
    description: 'Формат файлу не підтримується.',
  },
  {
    status: 422,
    title: 'Unprocessable Content',
    description: 'Файл пошкоджений або конвертація неможлива.',
  },
  {
    status: 429,
    title: 'Too Many Requests',
    description: 'Перевищено обмеження запитів. Зменште частоту звернень.',
  },
  { status: 500, title: 'Internal Server Error', description: 'Непередбачена помилка сервісу.' },
  { status: 503, title: 'Service Unavailable', description: 'Сервіс тимчасово недоступний.' },
] as const;
