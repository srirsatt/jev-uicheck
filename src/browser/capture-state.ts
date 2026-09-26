import type { Page } from 'playwright';

// playwright ARIA snapshot capture - minimal snapshot as BEFORE & AFTER context into jev



export interface PageState {
  url: string;
  title: string;
  ariaSnapshot: string;
  capturedAt: string;
}

/** The caller navigates and waits for the expected UI before capturing. */
export async function capturePageState(page: Page): Promise<PageState> {
  const url = page.url();
  const title = await page.title();
  const ariaSnapshot = await page.locator('body').ariaSnapshot({
    timeout: 5_000,
  });

  // Avoid mixing evidence from different URLs if navigation happened mid-capture.
  // This does not detect same-URL reloads or UI updates; readiness belongs to the runner.
  if (page.url() !== url) {
    throw new Error('Page navigated during capture; wait for readiness and retry.');
  }

  return {
    url,
    title,
    ariaSnapshot,
    capturedAt: new Date().toISOString(),
  };
}
