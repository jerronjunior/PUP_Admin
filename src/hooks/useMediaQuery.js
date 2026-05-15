// src/hooks/useMediaQuery.js
// Mirrors Flutter's MediaQuery — returns true when the CSS media query matches.
// Used by BinsPage for responsive layout (mobile vs desktop).
import { useState, useEffect } from 'react';

export default function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false)
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mq = window.matchMedia(query);
    const handler = e => setMatches(e.matches);

    // Modern browsers
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    // Older Safari fallback
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, [query]);

  return matches;
}
