import { useEffect, useState } from 'react';
import { sections } from './api-reference';

export function useActiveSection() {
  const [activeSection, setActiveSection] = useState<string>(sections[0].id);

  useEffect(() => {
    const headings = sections.flatMap(({ id }) => {
      const heading = document.getElementById(id);
      return heading ? [heading] : [];
    });
    let frame: number | undefined;
    let active = true;
    let destination: string | undefined;
    let settling: number | undefined;
    function finish() {
      window.clearTimeout(settling);
      destination = undefined;
      schedule();
    }
    function settle() {
      window.clearTimeout(settling);
      // Also covers browsers without scrollend, unchanged hashes and no-op jumps.
      settling = window.setTimeout(finish, 180);
    }
    function select(hash: string) {
      let id: string;
      try {
        id = decodeURIComponent(hash.slice(1));
      } catch {
        return;
      }
      if (!headings.some((heading) => heading.id === id)) return;
      destination = id;
      setActiveSection(id);
      settle();
    }
    function onClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download'))
        return;
      const url = new URL(link.href);
      if (
        url.origin === location.origin &&
        url.pathname === location.pathname &&
        url.search === location.search
      )
        select(url.hash);
    }
    function onHashChange() {
      const clicked = destination;
      select(location.hash);
      // Retarget from the current position after the native fragment has changed.
      // Chromium can otherwise reuse an obsolete offset during rapid clicks.
      if (clicked && clicked === destination) {
        document.getElementById(clicked)?.scrollIntoView({ block: 'start' });
      }
    }
    function onKey(event: KeyboardEvent) {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key))
        finish();
    }
    function onScrollEnd() {
      if (!destination) return;
      const heading = document.getElementById(destination);
      const offset = heading
        ? parseFloat(getComputedStyle(heading).scrollMarginBlockStart) || 0
        : 0;
      if (heading && Math.abs(heading.getBoundingClientRect().top - offset) <= 1) finish();
    }
    function update() {
      frame = undefined;
      if (!headings.length || destination) return;
      // The header is in normal flow; the sidebar never covers the article.
      // Use the same breathing room as native fragment alignment, at every breakpoint.
      const offset = parseFloat(getComputedStyle(headings[0]!).scrollMarginBlockStart) || 0;
      let current = headings[0]!;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= offset + 1) current = heading;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
        current = headings.at(-1)!;
      }
      setActiveSection(current.id);
    }
    function schedule() {
      if (active && frame === undefined) frame = window.requestAnimationFrame(update);
    }
    function onScroll() {
      if (destination) settle();
      else schedule();
    }
    // Six headings: one batched measurement per frame also handles rapid jumps
    // that can skip IntersectionObserver thresholds and short final sections.
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('wheel', finish, { passive: true });
    window.addEventListener('touchstart', finish, { passive: true });
    window.addEventListener('pointerdown', finish);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);
    void (document.fonts?.ready ?? Promise.resolve()).then(schedule);
    onHashChange();
    schedule();
    return () => {
      active = false;
      window.clearTimeout(settling);
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('wheel', finish);
      window.removeEventListener('touchstart', finish);
      window.removeEventListener('pointerdown', finish);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);

  return activeSection;
}
