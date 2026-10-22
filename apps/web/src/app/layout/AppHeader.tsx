import { useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { ActionLink } from '../../shared/ui/ActionLink';
import { Button } from '../../shared/ui/Button';
import { useAuth } from '../../features/auth/lib/auth-context';
import { SessionActions } from '../../features/auth/components/SessionActions';
import styles from './AppLayout.module.scss';

export function AppHeader() {
  const { pathname } = useLocation();
  const { status, session } = useAuth();
  const [open, setOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  function closeMenu() {
    setOpen(false);
    menuButton.current?.focus();
  }

  return (
    <header
      className={`container ${styles.header}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeMenu();
        }
      }}
    >
      <Link className={styles.brand} to="/" aria-label="converter — головна">
        converter
      </Link>
      <Button
        ref={menuButton}
        variant="secondary"
        className={styles.menuButton}
        aria-label={open ? 'Закрити меню' : 'Відкрити меню'}
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => setOpen(!open)}
      >
        {open ? (
          <X size={22} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Menu size={22} strokeWidth={1.75} aria-hidden="true" />
        )}
      </Button>
      <nav
        id="primary-navigation"
        aria-label="Основна навігація"
        className={styles.nav}
        data-open={open}
      >
        <NavLink to="/" end className={styles.navLink ?? ''}>
          Конвертер
        </NavLink>
        <NavLink to="/api-docs" className={styles.navLink ?? ''}>
          API
        </NavLink>
        <SessionActions />
        {status === 'unavailable' || (status === 'ready' && session?.kind === 'anonymous') ? (
          <ActionLink
            to="/login"
            variant="secondary"
            aria-current={pathname.replace(/\/$/, '') === '/login' ? 'page' : undefined}
          >
            Увійти
          </ActionLink>
        ) : null}
      </nav>
    </header>
  );
}
