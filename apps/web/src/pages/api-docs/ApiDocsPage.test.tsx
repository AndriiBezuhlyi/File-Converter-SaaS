import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { ApiDocsPage } from './ApiDocsPage';

it('identifies the pre-launch contract and documents all seven agreed public operations', () => {
  render(<ApiDocsPage />);
  expect(screen.getByRole('note', { name: 'Доступність API' })).toHaveTextContent(
    'API ще готується.',
  );
  const operations = screen
    .getAllByRole('heading', { level: 3 })
    .map(
      (heading) =>
        `${heading.querySelector('span')?.textContent} ${heading.querySelector('code')?.textContent}`,
    );
  expect(operations).toEqual([
    'POST /api/v1/conversions',
    'GET /api/v1/conversions/:id',
    'GET /api/v1/conversions/:id/download',
    'GET /api/v1/files',
    'GET /api/v1/files/:id',
    'GET /api/v1/files/:id/download',
    'DELETE /api/v1/files/:id',
  ]);
  const contents = screen.getByRole('navigation', { name: 'Зміст документації API' });
  for (const link of within(contents).getAllByRole('link')) {
    const id = link.getAttribute('href')!.slice(1);
    expect(document.getElementById(id)?.tagName).toBe('H2');
  }
  expect(screen.getByRole('table', { name: 'HTTP-статуси помилок' })).toHaveTextContent('410');
  expect(screen.getByRole('table', { name: 'Обмеження першої версії' })).toHaveTextContent('20 МБ');
});

it('uses placeholder credentials, multipart fields, and the documented response/error examples', () => {
  render(<ApiDocsPage />);
  const create = screen.getByRole('region', { name: 'Код: cURL · Створення задачі' }).textContent!;
  expect(create).toContain('https://api.example.com/api/v1/conversions');
  expect(create).toContain("--header 'X-API-Key: YOUR_API_KEY'");
  expect(create).toContain("--form 'file=@./image.jpg'");
  expect(create).toContain("--form 'targetFormat=png'");
  expect(create).not.toContain('Content-Type:');
  expect(
    JSON.parse(screen.getByRole('region', { name: 'Код: JSON · 202 Accepted' }).textContent!),
  ).toMatchObject({ status: 'queued', id: 'conversion_123' });
  expect(
    JSON.parse(screen.getByRole('region', { name: 'Код: JSON · Помилка запиту' }).textContent!),
  ).toEqual({
    error: { code: 'FILE_TOO_LARGE', message: 'The uploaded file exceeds the allowed size.' },
  });
});
