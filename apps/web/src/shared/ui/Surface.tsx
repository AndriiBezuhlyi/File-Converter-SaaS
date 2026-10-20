import type { ComponentPropsWithoutRef } from 'react';
import styles from './Surface.module.scss';

export function Surface({ className = '', ...props }: ComponentPropsWithoutRef<'section'>) {
  return <section className={`${styles.surface} ${className}`} {...props} />;
}
