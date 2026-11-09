import { ArrowDown } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { ConverterWorkspace } from '../../features/converter/components/ConverterWorkspace';
import type { ConversionGateway } from '../../features/converter/lib/conversion-gateway';
import styles from './ConverterPage.module.scss';

const steps = [
  {
    title: 'Виберіть файл',
    description: 'Перетягніть зображення або документ чи виберіть його на пристрої.',
  },
  { title: 'Оберіть формат', description: 'Виберіть, у який формат потрібно конвертувати файл.' },
  {
    title: 'Завантажте результат',
    description: 'Після конвертації ви зможете завантажити готовий файл.',
  },
];

const rasterFormats = ['jpg', 'png', 'webp', 'avif'] as const;
const documentFormats = ['docx', 'odt', 'xlsx', 'pptx', 'csv', 'txt'] as const;

function FormatGroup({ formats }: { formats: readonly string[] }) {
  return (
    <span className={styles.formatGroup}>
      {formats.map((format) => (
        <span key={format} className={`${styles.format} ${styles[format]}`}>
          {format === 'webp' ? 'WebP' : format === 'gif' ? 'GIF (static)' : format.toUpperCase()}
        </span>
      ))}
    </span>
  );
}

export function ConverterPage({ gateway }: { gateway?: ConversionGateway } = {}) {
  const [search, setSearch] = useSearchParams();
  return (
    <>
      <div className={styles.hero} data-home-hero>
        <div>
          <h1 className={styles.heading}>Конвертуй файли без зайвих труднощів</h1>
          <p className={styles.intro}>Зображення та документи — у потрібному форматі.</p>
          <div className={styles.formats}>
            <p>
              <FormatGroup formats={rasterFormats} />
              <span className={styles.direction}>↔ між собою</span>
            </p>
            <p>
              <FormatGroup formats={['gif', 'svg']} />
              <span className={styles.direction} aria-label="у">
                →
              </span>
              <FormatGroup formats={rasterFormats} />
            </p>
            <p>
              <FormatGroup formats={documentFormats} />
              <span className={styles.direction} aria-label="у">
                →
              </span>
              <FormatGroup formats={['pdf']} />
            </p>
          </div>
          <a className={styles.anchor} href="#how-it-works">
            Як це працює <ArrowDown size={20} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
        <ConverterWorkspace
          gateway={gateway}
          requestedId={search.get('conversion')}
          onJobId={(id) => {
            setSearch(
              (previous) => {
                const next = new URLSearchParams(previous);
                if (id) next.set('conversion', id);
                else next.delete('conversion');
                return next;
              },
              { replace: true },
            );
          }}
        />
      </div>
      <section className={styles.instructions} aria-labelledby="how-it-works">
        <h2 className={styles.annotation} id="how-it-works" tabIndex={-1}>
          {'{ Як це працює }'}
        </h2>
        <ol role="list" className={styles.steps}>
          {steps.map((step) => (
            <li key={step.title}>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
        <p className={styles.retention}>Тимчасові результати доступні протягом 1 години.</p>
      </section>
    </>
  );
}
