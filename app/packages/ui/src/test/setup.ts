// jsdom intentionally implements matchMedia only when a layout engine is
// available. Components use it solely as an enhancement, so tests receive a
// deterministic no-match implementation.
if (window.matchMedia === undefined) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
