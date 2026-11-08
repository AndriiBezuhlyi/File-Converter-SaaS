import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigationType, NavigationType } from 'react-router';
import { AppHeader } from './AppHeader';
import { getRouteTitle } from '../routes';
import styles from './AppLayout.module.scss';
import { Brand } from './Brand';

export function AppLayout() {
  const { pathname, search, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(pathname);
  const previousKey = useRef(key);
  const initial = useRef(true);
  const positions = useRef(new Map<string, { top: number; left: number }>());
  const entry = `${key}:${pathname}${search}${hash}`;
  const currentEntry = useRef({ entry, url: window.location.href });

  useLayoutEffect(() => {
    currentEntry.current = { entry, url: window.location.href };
  }, [entry]);
  useEffect(() => {
    const remember = () => {
      // Native fragment scrolling can start before the router commits its location.
      if (currentEntry.current.url !== window.location.href) return;
      positions.current.set(currentEntry.current.entry, {
        top: window.scrollY,
        left: window.scrollX,
      });
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      window.removeEventListener('scroll', remember);
    };
  }, []);

  useLayoutEffect(() => {
    document.title = `${getRouteTitle(pathname)} — Flux Converter`;
    const pathChanged = previousPath.current !== pathname;
    // Native fragment entries retain the router key. Let the browser own their
    // scrolling and history restoration instead of interrupting it with scrollTo.
    const nativeFragment = !pathChanged && previousKey.current === key;
    previousKey.current = key;
    const restoreHash =
      hash && (initial.current || (pathChanged && navigationType !== NavigationType.Pop));
    const position =
      !initial.current && !nativeFragment && navigationType === NavigationType.Pop
        ? positions.current.get(entry)
        : undefined;
    if (!positions.current.has(entry)) positions.current.set(entry, { top: 0, left: 0 });
    if (pathChanged && !hash && navigationType !== NavigationType.Pop) {
      document.getElementById('main-content')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    }
    previousPath.current = pathname;
    if (!restoreHash && !position) {
      initial.current = false;
      return;
    }

    let id: string;
    try {
      id = restoreHash ? decodeURIComponent(hash.slice(1)) : '';
    } catch {
      return;
    }
    let active = true;
    let frame: number | undefined;
    const cancel = () => {
      active = false;
      initial.current = false;
    };
    // Repair SPA fragments after font layout. Known history entries restore the
    // reader's position, which may differ from the URL's original fragment.
    window.addEventListener('wheel', cancel, { passive: true });
    window.addEventListener('pointerdown', cancel);
    window.addEventListener('keydown', cancel);
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!active) return;
      frame = window.requestAnimationFrame(() => {
        if (!active) return;
        initial.current = false;
        if (position) {
          window.scrollTo({ ...position, behavior: 'instant' });
          return;
        }
        const target = document.getElementById(id);
        target?.scrollIntoView({ block: 'start', behavior: 'instant' });
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      active = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('pointerdown', cancel);
      window.removeEventListener('keydown', cancel);
    };
  }, [pathname, hash, entry, key, navigationType]);

  return (
    <div className={styles.layout}>
      <a className={styles.skipLink} href="#main-content">
        Перейти до вмісту
      </a>
      <AppHeader key={pathname} />
      <main
        id="main-content"
        tabIndex={-1}
        aria-label="Flux Converter"
        className={`container ${styles.main}`}
      >
        <Outlet />
      </main>
      <footer className={`container ${styles.footer}`}>
        <Link className={styles.brand} to="/" aria-label="Flux Converter — головна">
          <Brand />
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
