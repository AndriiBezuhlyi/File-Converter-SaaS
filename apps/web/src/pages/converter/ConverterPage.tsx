import { ArrowDown, ArrowLeftRight, ArrowRight } from 'lucide-react';
import { FileSelector } from '../../features/converter/components/FileSelector';
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

export function ConverterPage() {
  return (
    <>
      <div className={styles.hero}>
        <div>
          <h1 className={styles.heading}>
            <span>Інший формат.</span> <span>Той самий файл.</span>
          </h1>
          <p className={styles.intro}>Зображення та документи — у потрібному форматі.</p>
          <p className={styles.formats}>
            <span className="sr-only">JPG у PNG та PNG у JPG; DOCX у PDF.</span>
            <span className={styles.jpg} aria-hidden="true">
              JPG
            </span>
            <ArrowLeftRight size={20} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.png} aria-hidden="true">
              PNG
            </span>
            <span aria-hidden="true">·</span>
            <span className={styles.docx} aria-hidden="true">
              DOCX
            </span>
            <ArrowRight size={20} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.pdf} aria-hidden="true">
              PDF
            </span>
          </p>
          <a className={styles.anchor} href="#how-it-works">
            Як це працює <ArrowDown size={20} strokeWidth={1.75} aria-hidden="true" />
          </a>
        </div>
        <FileSelector />
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
