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
    function update() {
      frame = undefined;
      if (!headings.length) return;
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
    // Six headings: one batched measurement per frame also handles rapid jumps
    // that can skip IntersectionObserver thresholds and short final sections.
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    observer?.observe(document.documentElement);
    void (document.fonts?.ready ?? Promise.resolve()).then(schedule);
    schedule();
    return () => {
      active = false;
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);

  return activeSection;
}
