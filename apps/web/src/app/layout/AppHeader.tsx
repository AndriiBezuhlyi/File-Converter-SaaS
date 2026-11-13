import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { ActionLink } from '../../shared/ui/ActionLink';
import { Button } from '../../shared/ui/Button';
import { useAuth } from '../../features/auth/lib/auth-context';
import { SessionActions } from '../../features/auth/components/SessionActions';
import styles from './AppLayout.module.scss';
import { Brand } from './Brand';

export function AppHeader() {
  const location = useLocation();
  const { pathname } = location;
  const { status, session } = useAuth();
  const [open, setOpen] = useState(false);
  const [menuLocation, setMenuLocation] = useState(location.key);
  if (menuLocation !== location.key) {
    setMenuLocation(location.key);
    setOpen(false);
  }
  const menuButton = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !header.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  function closeMenu() {
    setOpen(false);
    menuButton.current?.focus();
  }

  return (
    <header
      ref={header}
      className={`container ${styles.header}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          closeMenu();
        }
      }}
    >
      <Link className={styles.brand} to="/" aria-label="Flux Converter — головна">
        <Brand />
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
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest('a[href]')) setOpen(false);
        }}
        onBlur={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            !event.currentTarget.contains(event.relatedTarget) &&
            !menuButton.current?.contains(event.relatedTarget)
          )
            setOpen(false);
        }}
      >
        <NavLink to="/" end className={styles.navLink ?? ''}>
          Конвертер
        </NavLink>
        <NavLink to="/api-docs" className={styles.navLink ?? ''}>
          API
        </NavLink>
        <SessionActions navLinkClassName={styles.navLink ?? ''} />
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
