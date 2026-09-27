import type { ConsoleMessage, Page, Request, Response } from 'playwright';


// basically -> this is just error capture on HTTP requests or console request thruout the website
// if we fail here then we have an error to catch, but this doesnt encompass all error types we can think of


// These are observations. A later check decides whether each one should block.
export type BrowserEvent = { observedAt: string } & (
  // errors events as a type -> reporting the types of error events
  | { kind: 'console-error'; message: string; url: string; line: number }
  | { kind: 'page-error'; message: string; stack: string | undefined }
  | { kind: 'request-failed'; url: string; method: string; reason: string }
  | { kind: 'http-error'; url: string; method: string; status: number }
);

export interface BrowserEvidence {
  events: BrowserEvent[];
  droppedEvents: number;
}

/** Start before navigation; stop after the snapshot or an unsuccessful capture. */
export function collectBrowserEvents(page: Page) {
  const events: BrowserEvent[] = [];
  let droppedEvents = 0;

  // Keep a noisy/broken page from creating an unbounded evidence payload.
  const record = (event: BrowserEvent) => {
    if (events.length < 200) events.push(event);
    else droppedEvents += 1;
  };

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    record({
      kind: 'console-error',
      message: message.text(),
      url: location.url,
      line: location.lineNumber, // Playwright uses zero-based source lines.
      observedAt: new Date().toISOString(),
    });
  };

  const onPageError = (error: Error) => record({
    kind: 'page-error',
    message: error.message,
    stack: error.stack,
    observedAt: new Date().toISOString(),
  });

  const onRequestFailed = (request: Request) => record({
    kind: 'request-failed',
    url: request.url(),
    method: request.method(),
    reason: request.failure()?.errorText ?? 'Unknown network failure',
    observedAt: new Date().toISOString(),
  });

  // HTTP 404/500 responses do not emit requestfailed: the server did respond.
  const onResponse = (response: Response) => {
    if (response.status() < 400) return;
    record({
      kind: 'http-error',
      url: response.url(),
      method: response.request().method(),
      status: response.status(),
      observedAt: new Date().toISOString(),
    });
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  return {
    stop(): BrowserEvidence {
      // Remove only our listeners, preserving any other user's instrumentation.
      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('requestfailed', onRequestFailed);
      page.off('response', onResponse);
      return { events: [...events], droppedEvents };
    },
  };
}
