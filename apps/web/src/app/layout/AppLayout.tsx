import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { AppHeader } from './AppHeader';
import { getRouteTitle } from '../routes';
import styles from './AppLayout.module.scss';

export function AppLayout() {
  const { pathname } = useLocation();
  const previousPath = useRef(pathname);

  useEffect(() => {
    document.title = `${getRouteTitle(pathname)} — converter`;
    if (previousPath.current !== pathname) {
      document.getElementById('main-content')?.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
    previousPath.current = pathname;
  }, [pathname]);

  return (
    <div className={styles.layout}>
      <a className={styles.skipLink} href="#main-content">
        Перейти до вмісту
      </a>
      <AppHeader key={pathname} />
      <main
        id="main-content"
        tabIndex={-1}
        aria-label="File Converter"
        className={`container ${styles.main}`}
      >
        <Outlet />
      </main>
      <footer className={`container ${styles.footer}`}>
        <Link className={styles.brand} to="/" aria-label="converter — головна">
          converter
        </Link>
        <nav aria-label="Навігація в підвалі" className={styles.footerLinks}>
          <Link to="/" className={styles.navLink}>
            Конвертер
          </Link>
          <Link to="/api-docs" className={styles.navLink}>
            API
          </Link>
        </nav>
      </footer>
    </div>
  );
}
