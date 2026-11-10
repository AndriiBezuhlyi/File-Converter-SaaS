// Documentation examples mirror the implemented OpenAPI contract.
// Placeholder hosts and credentials do not establish deployment availability.
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
      id: '11111111-1111-4111-8111-111111111111',
      status: 'queued',
      sourceFormat: 'jpg',
      targetFormat: 'png',
      createdAt: '2026-10-13T18:00:00Z',
      saveResult: false,
    },
    null,
    2,
  ),
  status: [
    "curl 'https://api.example.com/api/v1/conversions/11111111-1111-4111-8111-111111111111' \\",
    "  --header 'X-API-Key: YOUR_API_KEY'",
  ].join('\n'),
  completed: JSON.stringify(
    {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'completed',
      sourceFormat: 'jpg',
      targetFormat: 'png',
      createdAt: '2026-10-13T18:00:00Z',
      saveResult: false,
      completedAt: '2026-10-13T18:00:05Z',
      error: null,
      resultAvailability: 'available',
      result: {
        id: '22222222-2222-4222-8222-222222222222',
        owner: 'account',
        name: 'image.png',
        format: 'png',
        sizeBytes: 12345,
        retention: 'temporary',
        expiresAt: '2026-10-13T19:00:05Z',
        availability: 'available',
      },
    },
    null,
    2,
  ),
  download: [
    "curl --fail 'https://api.example.com/api/v1/conversions/11111111-1111-4111-8111-111111111111/download' \\",
    "  --header 'X-API-Key: YOUR_API_KEY' \\",
    "  --output './result.png'",
  ].join('\n'),
  files: [
    "curl 'https://api.example.com/api/v1/files?format=png&sort=newest&limit=20' \\",
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
    description: 'Гостьова конвертація вже виконується або операція конфліктує з поточним станом.',
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
