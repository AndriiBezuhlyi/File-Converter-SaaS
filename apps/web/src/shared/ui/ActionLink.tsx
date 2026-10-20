import { Link, type LinkProps } from 'react-router';
import styles from './Action.module.scss';

interface ActionLinkProps extends LinkProps {
  variant?: 'primary' | 'secondary';
}

export function ActionLink({ variant = 'primary', className = '', ...props }: ActionLinkProps) {
  return (
    <Link
      className={`${styles.action} ${variant === 'secondary' ? styles.secondary : ''} ${className}`}
      {...props}
    />
  );
}
