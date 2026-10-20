import { ArrowLeft } from 'lucide-react';
import { ActionLink } from '../../shared/ui/ActionLink';
import styles from './RoutePreview.module.scss';

interface RoutePreviewProps {
  title: string;
  description: string;
}

export function RoutePreview({ title, description }: RoutePreviewProps) {
  return (
    <section className={styles.page}>
      <h1 className={styles.heading}>{title}</h1>
      <p className={styles.description}>{description}</p>
      <ActionLink to="/">
        <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        До конвертера
      </ActionLink>
    </section>
  );
}
