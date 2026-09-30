// Expectations are declared before inference. These are agent-authored fixture
// labels, not independent human ground truth. Review before making accuracy claims.
export function document(body, { title = 'Fixture', style = '', script = '', setup = '', ready = true } = {}) {
  return `<!doctype html><html lang="en"><head><title>${title}</title><style>body{min-height:30px}${style}</style></head>
    <body>${body}<script>${script}</script><script>
      (async () => { ${setup}; ${ready ? 'document.body.dataset.ready = "true";' : ''} })();
    </script></body></html>`;
}

const apps = [
  { id: 'login', split: 'development', heading: 'Account login', button: 'Log in', renamed: 'Sign in', link: 'Forgot password?', checkbox: 'Remember me' },
  { id: 'shop', split: 'evaluation', heading: 'Shopping cart', button: 'Checkout', renamed: 'Place order', link: 'Continue shopping', checkbox: 'Gift wrapping' },
  { id: 'settings', split: 'evaluation', heading: 'Profile settings', button: 'Save profile', renamed: 'Save changes', link: 'Cancel changes', checkbox: 'Email notifications' },
];

export const semanticCases = apps.flatMap((app) => {
  const markup = ({ heading = app.heading, button = app.button, link = true, checkbox = false } = {}) =>
    `<h1>${heading}</h1>${checkbox ? `<label><input type="checkbox">${app.checkbox}</label>` : ''}
     ${button ? `<button>${button}</button>` : ''}${link ? `<a href="#help">${app.link}</a>` : ''}<p role="status"></p>`;
  const beforeHtml = document(markup(), { title: app.heading });
  const added = `Add a checkbox labeled "${app.checkbox}". Preserve all existing controls and text.`;
  const spec = (role, name, count = 1) => ({ role, name, count });
  const cases = [
    { id: 'rename-correct', prompt: `Rename the "${app.button}" button to "${app.renamed}".`,
      afterHtml: document(markup({ button: app.renamed }), { title: app.heading }),
      primary: 'intent', expected: 'satisfied', rationale: 'The requested label replacement is present in the diff.',
      assertions: [spec('button', app.renamed), spec('button', app.button, 0)] },
    { id: 'rename-wrong', prompt: `Rename the "${app.button}" button to "${app.renamed}".`,
      afterHtml: document(markup({ button: 'Wrong label' }), { title: app.heading }),
      primary: 'intent', expected: 'violated', rationale: 'The observed replacement label contradicts the requested label.',
      assertions: [spec('button', app.renamed)] },
    { id: 'add-correct', prompt: added,
      afterHtml: document(markup({ checkbox: true }), { title: app.heading }),
      primary: 'intent', expected: 'satisfied', rationale: 'The requested checkbox is added; the prompt asks only for its presence.',
      assertions: [spec('checkbox', app.checkbox), spec('button', app.button), spec('link', app.link)] },
    { id: 'remove-requested', prompt: `Remove the "${app.link}" link.`,
      afterHtml: document(markup({ link: false }), { title: app.heading }),
      primary: 'unexpectedChanges', expected: 'satisfied', rationale: 'The sole removal is explicitly requested.',
      assertions: [spec('link', app.link, 0)] },
    { id: 'remove-unrequested', prompt: added,
      afterHtml: document(markup({ checkbox: true, link: false }), { title: app.heading }),
      primary: 'unexpectedChanges', expected: 'violated', rationale: 'An existing link was removed despite explicit preservation instructions.',
      assertions: [spec('checkbox', app.checkbox), spec('link', app.link)] },
    { id: 'remove-button', prompt: added,
      afterHtml: document(markup({ checkbox: true, button: '' }), { title: app.heading }),
      primary: 'regression', expected: 'violated', rationale: 'The existing primary action is absent after an unrelated checkbox addition.',
      assertions: [spec('checkbox', app.checkbox), spec('button', app.button)] },
    { id: 'unrelated-heading', prompt: added,
      afterHtml: document(markup({ checkbox: true, heading: 'Unrelated page title' }), { title: app.heading }),
      primary: 'unexpectedChanges', expected: 'violated', rationale: 'An unrelated heading changed despite explicit preservation instructions.',
      assertions: [spec('checkbox', app.checkbox), spec('heading', app.heading)] },
    { id: 'visual-only', prompt: 'Make the primary button blue and improve its spacing.',
      afterHtml: document(markup(), { title: app.heading, style: 'button{background:blue;margin:20px}' }),
      primary: 'intent', expected: 'insufficient_evidence', rationale: 'Style changes are not observable in the supplied ARIA diff.' },
    { id: 'behavior-only', prompt: 'Make clicking the primary button display a confirmation message.',
      afterHtml: document(markup(), { title: app.heading,
        script: `document.querySelector('button').onclick = () => { document.querySelector('[role="status"]').textContent = 'Confirmed'; };` }),
      primary: 'intent', expected: 'insufficient_evidence', rationale: 'The benchmark has not clicked the button; snapshots cannot verify this behavior.' },
    { id: 'backend-only', prompt: 'Persist the current selections to the database when the primary button is clicked.',
      afterHtml: beforeHtml,
      primary: 'intent', expected: 'insufficient_evidence', rationale: 'No interaction or backend observation exists in the model input.' },
  ];
  return cases.map((item) => ({ ...item, id: `${app.id}/${item.id}`, app: app.id, split: app.split, beforeHtml }));
});

export const healthCases = [
  { id: 'clean', expected: 'pass', html: document('<h1>Ready</h1>') },
  { id: 'console', expected: 'fail', html: document('<h1>Ready</h1>', { script: 'console.error("Fixture console error");' }) },
  { id: 'exception', expected: 'fail', html: document('<h1>Ready</h1>', { script: 'throw new Error("Fixture exception");' }) },
  { id: 'http-404', expected: 'fail', html: document('<h1>Ready</h1>', { setup: 'await fetch("/api/404")' }) },
  { id: 'http-500', expected: 'fail', html: document('<h1>Ready</h1>', { setup: 'await fetch("/api/500")' }) },
  { id: 'network', expected: 'fail', html: document('<h1>Ready</h1>', { setup: 'await fetch("/api/offline").catch(() => {})' }) },
  { id: 'empty', expected: 'uncertain', html: document('') },
  { id: 'never-ready', expected: 'uncertain', html: document('<h1>Loading</h1>', { ready: false }) },
];
