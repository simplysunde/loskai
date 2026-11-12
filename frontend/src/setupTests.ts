import '@testing-library/jest-dom'

// jsdom has no AnimationEvent, and without it React listens for webkitAnimationEnd instead
// of animationend — so onAnimationEnd (QuickTerminal's timer) would never fire in a test.
if (!("AnimationEvent" in window)) {
  Object.defineProperty(window, "AnimationEvent", { value: Event, configurable: true });
}
