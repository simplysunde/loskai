// Asking for your password to unlock Loskai's SSH key — once, for the whole app, when
// something you did needs it (`requestUnlock`). The dialog is `UnlockPrompt`, mounted once
// in the layout; without it (a test rendering one component) nothing is asked and the
// request fails as locked.

type Listener = () => void;

let waiting: ((unlocked: boolean) => void)[] = [];
let mounted = 0;
const listeners = new Set<Listener>();

// Resolves true once the key is unlocked, false when the dialog is cancelled. Asked while
// the dialog is already open, it waits on the same answer.
export function requestUnlock(): Promise<boolean> {
  // A tick later: asked from an effect in the render that mounts the dialog too (a terminal
  // opened as the page loads), the dialog has subscribed by then.
  return new Promise((resolve) =>
    queueMicrotask(() => {
      if (mounted === 0) return resolve(false);
      waiting.push(resolve);
      listeners.forEach((l) => l());
    }),
  );
}

// For the dialog: whether it is asked for, and how it answers.
export function unlockAsked(): boolean {
  return waiting.length > 0;
}

export function answerUnlock(unlocked: boolean): void {
  const answer = waiting;
  waiting = [];
  answer.forEach((resolve) => resolve(unlocked));
  listeners.forEach((l) => l());
}

export function subscribeUnlock(listener: Listener): () => void {
  mounted += 1;
  listeners.add(listener);
  return () => {
    mounted -= 1;
    listeners.delete(listener);
    if (mounted === 0) answerUnlock(false);
  };
}
