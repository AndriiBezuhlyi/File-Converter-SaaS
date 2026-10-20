import { useEffect } from 'react';
import { ArrowUp } from 'lucide-react';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { errors, examples, fileOperations, sections } from './api-reference';
import styles from './ApiDocsPage.module.scss';

export function ApiDocsPage() {
  useEffect(() => {
    const fragment = window.location.hash.slice(1);
    if (fragment !== 'api-docs-title' && !sections.some((section) => section.id === fragment))
      return;
    const target = document.getElementById(fragment);
    if (!target) return;
    let active = true;
    let frame: number | undefined;

    // Native fragment restoration can precede SPA rendering or font layout.
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!active) return;
      frame = window.requestAnimationFrame(() => {
        if (!active || window.location.hash.slice(1) !== fragment) return;
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        target.focus({ preventScroll: true });
      });
    });

    return () => {
      active = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className={styles.layout}>
      <header className={styles.intro}>
        <h1 className={styles.title} id="api-docs-title" tabIndex={-1}>
          Документація API
        </h1>
        <p className={styles.lead}>Зображення та документи — у вашому застосунку.</p>
        <div className={styles.notice} role="note" aria-label="Доступність API">
          <p>
            <strong>API ще готується.</strong>
          </p>
          <p>Нижче — погоджений контракт і приклади майбутньої інтеграції.</p>
        </div>
      </header>
      <aside className={styles.sidebar}>
        <p className={styles.annotation}>{'{ На цій сторінці }'}</p>
        <nav aria-label="Зміст документації API">
          <ul role="list" className={styles.contents}>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.base}>
          <p>Базовий шлях</p>
          <code>/api/v1</code>
        </div>
      </aside>
      <article className={styles.article} aria-labelledby="api-docs-title">
        <section className={styles.section} aria-labelledby="quick-start">
          <h2 id="quick-start" tabIndex={-1}>
            Швидкий старт
          </h2>
          <p>
            Надішліть файл, перевірте статус, завантажте результат. Приклади cURL наведено для
            Bash/zsh.
          </p>
          <CodeBlock label="cURL · Створення задачі" code={examples.create} />
          <p>
            Домен <code>api.example.com</code> і <code>YOUR_API_KEY</code> — заповнювачі. Замініть
            їх доменом сервісу та своїм ключем після запуску API. Усі JSON-відповіді нижче —
            приклади.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="authentication">
          <h2 id="authentication" tabIndex={-1}>
            Авторизація
          </h2>
          <p>
            Передавайте <code>X-API-Key</code> у заголовку кожного HTTPS-запиту. Зберігайте ключ на
            своєму сервері, а не в URL чи публічному JavaScript.
          </p>
          <ul>
            <li>
              Акаунт матиме один активний ключ. Повний секрет показуватиметься лише під час
              створення або перевипуску в профілі.
            </li>
            <li>
              Перевипуск одразу деактивує попередній ключ. Відсутній, недійсний або відкликаний ключ
              означає <code>401 Unauthorized</code>.
            </li>
            <li>
              Недійсний явний ключ не замінюється авторизацією через cookies. API-ключ не дозволяє
              керувати паролем або випускати інші ключі.
            </li>
            <li>
              Безкоштовна гостьова конвертація передбачена для вебсайту. Стороннім інтеграціям
              завжди потрібен API-ключ.
            </li>
          </ul>
        </section>

        <section className={styles.section} aria-labelledby="conversions">
          <h2 id="conversions" tabIndex={-1}>
            Конвертації
          </h2>
          <div className={styles.operation}>
            <h3>
              <span className={styles.method}>POST</span>
              <code>/api/v1/conversions</code>
            </h3>
            <p>
              Приймає один файл як <code>multipart/form-data</code> і повертає{' '}
              <code>202 Accepted</code>. Не задавайте multipart Content-Type вручну: cURL додасть
              boundary.
            </p>
            <table className={styles.table}>
              <caption>Поля створення задачі</caption>
              <thead>
                <tr>
                  <th scope="col">Поле</th>
                  <th scope="col">Значення</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    <code>file</code>
                  </th>
                  <td>Один файл JPG, PNG або DOCX.</td>
                </tr>
                <tr>
                  <th scope="row">
                    <code>targetFormat</code>
                  </th>
                  <td>
                    <code>jpg</code>, <code>png</code> або <code>pdf</code>, відповідно до вхідного
                    файлу.
                  </td>
                </tr>
              </tbody>
            </table>
            <p>
              <code>202</code> означає прийняття задачі, а не завершення конвертації. Збережіть
              отриманий <code>id</code>.
            </p>
            <CodeBlock label="JSON · 202 Accepted" code={examples.accepted} />
          </div>
          <div className={styles.operation}>
            <h3>
              <span className={styles.method}>GET</span>
              <code>/api/v1/conversions/:id</code>
            </h3>
            <p>
              Перевіряйте стан задачі кожні 1–2 секунди. Замініть <code>:id</code> її
              ідентифікатором; припиніть polling після завершення або остаточної помилки.
            </p>
            <dl className={styles.stateList}>
              <dt>queued</dt>
              <dd>Очікує обробки.</dd>
              <dt>processing</dt>
              <dd>Конвертація виконується.</dd>
              <dt>completed</dt>
              <dd>Результат готовий.</dd>
              <dt>failed</dt>
              <dd>Задача завершилася помилкою.</dd>
            </dl>
            <CodeBlock label="cURL · Статус задачі" code={examples.status} />
            <CodeBlock label="JSON · Завершена задача" code={examples.completed} />
            <p>
              Помилка вже прийнятої задачі відображається станом <code>failed</code>, навіть якщо
              запит статусу повернув HTTP 200. Втрата з’єднання під час polling не означає помилку
              конвертації. Не повторюйте завантаження автоматично після неоднозначної відповіді.
            </p>
          </div>
          <div className={styles.operation}>
            <h3>
              <span className={styles.method}>GET</span>
              <code>/api/v1/conversions/:id/download</code>
            </h3>
            <p>
              Повертає готовий файл із <code>Content-Type</code> і <code>Content-Disposition</code>.
              Доступ перевіряється за власником. <code>downloadUrl</code> не є публічним посиланням:
              передайте свій API-ключ і під час завантаження.
            </p>
            <CodeBlock label="cURL · Завантаження результату" code={examples.download} />
            <p>
              Для незавершеної задачі передбачено <code>409</code>, для власного простроченого або
              видаленого результату — <code>410</code>, для недоступного клієнту ресурсу —{' '}
              <code>404</code>.
            </p>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="saved-files">
          <h2 id="saved-files" tabIndex={-1}>
            Збережені файли
          </h2>
          <p>
            Операції доступні лише для файлів власника ключа. У шляхах нижче <code>:id</code> —
            ідентифікатор файлу, а не задачі.
          </p>
          {fileOperations.map((operation) => (
            <div className={styles.operation} key={operation.method + operation.path}>
              <h3>
                <span className={operation.method === 'DELETE' ? styles.delete : styles.method}>
                  {operation.method}
                </span>
                <code>{operation.path}</code>
              </h3>
              <p>{operation.description}</p>
            </div>
          ))}
          <CodeBlock label="cURL · Список збережених файлів" code={examples.files} />
          <p>Параметри пагінації, фільтрів і схеми метаданих будуть уточнені перед запуском API.</p>
        </section>

        <section className={styles.section} aria-labelledby="limits">
          <h2 id="limits" tabIndex={-1}>
            Ліміти та зберігання
          </h2>
          <table className={styles.table}>
            <caption>Обмеження першої версії</caption>
            <thead>
              <tr>
                <th scope="col">Обмеження</th>
                <th scope="col">Правило</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Напрямки</th>
                <td>JPG ↔ PNG та DOCX → PDF. PDF → DOCX не підтримується.</td>
              </tr>
              <tr>
                <th scope="row">Файл</th>
                <td>Один файл до 20 МБ. Сервер перевірятиме реальний вміст, формат і розмір.</td>
              </tr>
              <tr>
                <th scope="row">Тимчасовий результат</th>
                <td>Доступний 1 годину після завершення, якщо автозбереження вимкнено.</td>
              </tr>
              <tr>
                <th scope="row">Автозбереження</th>
                <td>
                  За ввімкненого налаштування результат додається до «Моїх файлів». Застосовується
                  значення на момент прийняття задачі.
                </td>
              </tr>
              <tr>
                <th scope="row">Зміна налаштувань</th>
                <td>Не змінює попередні результати й не видаляє вже збережені файли.</td>
              </tr>
              <tr>
                <th scope="row">Частота запитів</th>
                <td>
                  Rate limiting і обмеження одночасних задач налаштовуватимуться сервером. Фіксовані
                  числові квоти ще не визначені.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className={styles.section} aria-labelledby="errors">
          <h2 id="errors" tabIndex={-1}>
            Помилки
          </h2>
          <p>
            Помилки HTTP-запитів мають спільну оболонку <code>error.code</code> і{' '}
            <code>error.message</code>. Відрізняйте відхилення запиту від помилки задачі, вже
            прийнятої з <code>202</code>.
          </p>
          <CodeBlock label="JSON · Помилка запиту" code={examples.error} />
          <table className={styles.table}>
            <caption>HTTP-статуси помилок</caption>
            <thead>
              <tr>
                <th scope="col">HTTP</th>
                <th scope="col">Що означає</th>
              </tr>
            </thead>
            <tbody>
              {errors.map((error) => (
                <tr key={error.status}>
                  <th scope="row">
                    <span className={styles.http}>{error.status}</span>
                    {error.title}
                  </th>
                  <td>{error.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <a className={styles.back} href="#api-docs-title">
          До початку <ArrowUp size={20} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </article>
    </div>
  );
}
