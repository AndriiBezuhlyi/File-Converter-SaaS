import { ArrowUp } from 'lucide-react';
import { CodeBlock } from '../../shared/ui/CodeBlock';
import { errors, examples, fileOperations, sections } from './api-reference';
import styles from './ApiDocsPage.module.scss';
import { useActiveSection } from './use-active-section';

export function ApiDocsPage() {
  const activeSection = useActiveSection();

  return (
    <div className={styles.layout}>
      <header className={styles.intro}>
        <h1 className={styles.title} id="api-docs-title" tabIndex={-1}>
          Документація API
        </h1>
        <p className={styles.lead}>Зображення та документи — у вашому застосунку.</p>
        <div className={styles.notice} role="note" aria-label="Доступність API">
          <p>
            <strong>Контракт реалізованого API.</strong>
          </p>
          <p>
            Доступність конкретного розгортання перевіряйте окремо; приклади використовують
            заповнювачі.
          </p>
        </div>
      </header>
      <aside className={styles.sidebar}>
        <p className={styles.annotation}>{'{ На цій сторінці }'}</p>
        <nav aria-label="Зміст документації API">
          <ul role="list" className={styles.contents}>
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={activeSection === section.id ? 'location' : undefined}
                >
                  {section.title}
                </a>
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
          <p>
            GET /api/v1/capabilities без авторизації повертає directions, maxUploadBytes,
            maxImagePixels, maxArchiveBytes, maxArchiveEntries і pollIntervalMs. Поточні межі: 40
            000 000 пікселів, 80 000 000 розпакованих байтів і 1000 елементів архіву. Це межі
            прийняття, а не гарантія швидкості чи точності відтворення документа.
          </p>
          <CodeBlock label="cURL · Створення задачі" code={examples.create} />
          <p>
            Домен <code>api.example.com</code> і <code>YOUR_API_KEY</code> — заповнювачі. Замініть
            їх доменом свого розгортання та своїм ключем. Усі JSON-відповіді нижче — приклади.
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
              Акаунт має один активний ключ. Повний секрет показується лише під час створення або
              перевипуску в профілі.
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
            <li>
              Auth, профіль, налаштування та керування ключами — операції вебзастосунку через
              cookie-сесію; явний X-API-Key там відхиляється. Зміни через cookies потребують точного
              Origin і X-CSRF-Token із GET /api/v1/auth/csrf. Гість додатково викликає POST
              /api/v1/guest-session з порожнім JSON-об’єктом. CORS для сторонніх браузерних
              інтеграцій не ввімкнено.
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
                  <td>
                    Одне статичне зображення JPG, PNG, WebP, AVIF, GIF, SVG або документ DOCX, ODT,
                    XLSX, PPTX, CSV, TXT.
                  </td>
                </tr>
                <tr>
                  <th scope="row">
                    <code>targetFormat</code>
                  </th>
                  <td>
                    <code>jpg</code>, <code>png</code>, <code>webp</code>, <code>avif</code> або{' '}
                    <code>pdf</code>, відповідно до вхідного файлу.
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
              Перевіряйте стан задачі кожні 1500 мс. Замініть <code>:id</code> її ідентифікатором;
              припиніть polling після завершення або остаточної помилки.
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
              Доступ перевіряється за власником. Статус не містить downloadUrl: побудуйте цей шлях з
              UUID задачі та передайте свій API-ключ і під час завантаження.
            </p>
            <CodeBlock label="cURL · Завантаження результату" code={examples.download} />
            <p>
              Для незавершеної або невдалої задачі передбачено <code>404</code>, для власного
              простроченого або видаленого результату — <code>410</code>, для недоступного клієнту
              ресурсу — <code>404</code>.
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
          <p>
            GET /files приймає search (до 200 символів, буквальний пошук без урахування регістру),
            format (jpg, png, webp, avif, pdf), sort (newest за замовчуванням або oldest), limit
            (1–100, за замовчуванням 20) і непрозорий cursor. Відповідь: items і nextCursor (null
            наприкінці). Передавайте nextCursor без змін із тими самими фільтрами та сортуванням;
            неправильний cursor дає 400 INVALID_QUERY. Метадані: id, name, format, sizeBytes,
            createdAt, retention, expiresAt. DELETE повертає 204, повторне видалення власного файлу
            безпечне; вже відкриті потоки не відкликаються.
          </p>
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
                <td>
                  JPG, PNG, WebP, AVIF — між різними форматами; статичні GIF і SVG → JPG, PNG, WebP,
                  AVIF; DOCX, ODT, XLSX, PPTX, CSV, TXT → PDF. SVG — прості фігури без тексту,
                  стилів і ресурсів. Анімація, GIF/SVG на виході та PDF → DOCX не підтримуються.
                  CSV: UTF-8 із необов’язковим BOM, коми, подвійні лапки; щонайменше дві колонки,
                  однакова кількість клітинок у рядках. Усі значення — текст, включно з формулами,
                  датами й початковими нулями. До 10 000 рядків, 256 колонок, 100 000 клітинок, 32
                  767 символів у клітинці. Інші роздільники й кодування не підтримуються. TXT:
                  UTF-8, переноси рядків і табуляція, автоматичний перенос довгих рядків. XLSX:
                  видимі аркуші й області друку; локальні формули перераховує Calc. PPTX: видимі
                  слайди без нотаток. Макроси, вкладені об’єкти, зовнішні ресурси та шифровані
                  документи не підтримуються. Верстка й шрифти можуть відрізнятися від Microsoft
                  Office.
                </td>
              </tr>
              <tr>
                <th scope="row">Файл</th>
                <td>
                  Один файл до 20 МБ (20 000 000 байтів). Сервер перевіряє реальний вміст, формат і
                  розмір.
                </td>
              </tr>
              <tr>
                <th scope="row">Тимчасовий результат</th>
                <td>
                  Доступний 1 годину після завершення для гостя або за вимкненого автозбереження
                  акаунту.
                </td>
              </tr>
              <tr>
                <th scope="row">Автозбереження</th>
                <td>
                  За ввімкненого налаштування результат додається до «Моїх файлів». Застосовується
                  значення на момент прийняття задачі. Збережені результати не мають автоматичного
                  строку видалення. Вхід в акаунт не переносить і не зберігає гостьовий результат.
                </td>
              </tr>
              <tr>
                <th scope="row">Зміна налаштувань</th>
                <td>Не змінює попередні результати й не видаляє вже збережені файли.</td>
              </tr>
              <tr>
                <th scope="row">Частота запитів</th>
                <td>
                  Створення: 20/IP/хв і 10/власник/хв. Читання конвертацій і файлів: 120/IP/хв і
                  120/власник/хв; DELETE файлу використовує лічильники змін 20/IP/хв і
                  10/власник/хв. До 5 активних задач на власника та 1000 загалом; для гостя — одна
                  зарезервована задача й одна успішна конвертація. Остаточна помилка звільняє
                  гостьовий резерв. API приймає до 4 одночасних завантажень на процес із дедлайном
                  60 с; нові формати зображень мають окремий слот перевірки. Перевищення частоти дає
                  429 RATE_LIMITED із Retry-After; переповнення слотів також дає 429.
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
