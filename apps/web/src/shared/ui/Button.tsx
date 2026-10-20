import type { ComponentProps } from 'react';
import styles from './Action.module.scss';

interface ButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'danger';
}

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${styles.action} ${variant === 'primary' ? '' : styles[variant]} ${className}`}
      {...props}
    />
  );
}
