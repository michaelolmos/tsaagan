// Kestrel MCP tool catalog.
//
// Each entry maps a Model Context Protocol tool to one Kestrel daemon action
// ({ action, args } over the localhost control plane). Input-schema property
// names match the daemon's arg names 1:1, so the handler can forward arguments
// verbatim — no translation layer to drift out of sync.
//
// The wedge: every mutating tool returns Kestrel's `verify` block
// (urlChanged, newConsoleErrors, failedRequests, expectTextFound) in the same
// response — proof the action worked, with no extra snapshot round-trip. That
// guarantee leads each mutating tool's description on purpose.

const REF = { type: 'string', description: "Stable element ref from kestrel_snapshot, e.g. 'e5'. Refs survive re-renders but reset after navigation — re-snapshot for fresh refs." };
const VERIFY_NOTE = 'Returns a verify block (urlChanged, console errors, failed requests, optional expected-text) so you know it worked without a separate snapshot.';

/** @typedef {{name:string,title:string,description:string,inputSchema:object,annotations:object,action:string,screenshot?:boolean}} Tool */

/** @type {Tool[]} */
export const TOOLS = [
  {
    name: 'kestrel_status',
    title: 'Daemon & Page Status',
    description: 'Report whether the Kestrel daemon is running, the active mode (Playwright CDP / macOS native / MV3 extension), and the current page URL/title. Call this first if other tools return a connection error.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {} },
    action: 'status',
  },
  {
    name: 'kestrel_navigate',
    title: 'Navigate to URL',
    description: `Navigate the browser to a URL. ${VERIFY_NOTE} Use kestrel_snapshot afterward to read the page.`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to navigate to (include https://).' },
        expectText: { type: 'string', description: 'Optional text expected on the page after load; reported in verify.expectTextFound.' },
      },
      required: ['url'],
    },
    action: 'goto',
  },
  {
    name: 'kestrel_snapshot',
    title: 'Accessibility Snapshot',
    description: 'Capture the current page as an accessibility tree with stable element refs (e1, e2...). No screenshot, no vision model needed — cheaper and more reliable than pixels. Pass full=true for the complete tree; default returns the interactive/condensed view.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { full: { type: 'boolean', description: 'Return the full accessibility tree instead of the condensed interactive view.', default: false } },
    },
    action: 'snapshot',
  },
  {
    name: 'kestrel_click',
    title: 'Click Element',
    description: `Click an element by stable ref, CSS selector, or visible text. ${VERIFY_NOTE} Prefer ref (from kestrel_snapshot) — it survives DOM re-renders where selectors break.`,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        ref: REF,
        selector: { type: 'string', description: 'CSS selector (alternative to ref).' },
        text: { type: 'string', description: 'Visible text to click (alternative to ref/selector).' },
        expectText: { type: 'string', description: 'Text expected to appear after the click (verify.expectTextFound).' },
        expectGone: { type: 'string', description: 'Text expected to disappear after the click.' },
      },
    },
    action: 'click',
  },
  {
    name: 'kestrel_type',
    title: 'Type Text',
    description: `Type text into an element (by ref/selector) with human-cadence keystrokes. Set submit=true to press Enter after. ${VERIFY_NOTE}`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        ref: REF,
        selector: { type: 'string', description: 'CSS selector (alternative to ref).' },
        text: { type: 'string', description: 'Text to type.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.', default: false },
        expectText: { type: 'string', description: 'Text expected to appear afterward (verify.expectTextFound).' },
      },
      required: ['text'],
    },
    action: 'type',
  },
  {
    name: 'kestrel_fill_form',
    title: 'Fill Form',
    description: `Fill multiple fields in one call, each by ref/selector/role+name, then optionally submit. ${VERIFY_NOTE}`,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'Fields to fill. Each: { ref|selector|role+name, value }.',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string' },
              selector: { type: 'string' },
              role: { type: 'string' },
              name: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['value'],
          },
        },
        submit: { type: 'boolean', description: 'Submit the form after filling.', default: false },
        expectText: { type: 'string', description: 'Text expected after submit.' },
      },
      required: ['fields'],
    },
    action: 'fill_form',
  },
  {
    name: 'kestrel_select',
    title: 'Select Option',
    description: `Select an option in a dropdown by value (or label). ${VERIFY_NOTE}`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        ref: REF,
        selector: { type: 'string', description: 'CSS selector (alternative to ref).' },
        value: { type: 'string', description: 'Option value to select.' },
        label: { type: 'string', description: 'Visible option label to select (alternative to value).' },
      },
    },
    action: 'select',
  },
  {
    name: 'kestrel_press',
    title: 'Press Key',
    description: `Press a key or chord (e.g. "Enter", "Escape", "Control+A"). ${VERIFY_NOTE}`,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'string', description: 'Key or chord, e.g. "Enter", "Tab", "Control+A".' },
        expectText: { type: 'string', description: 'Text expected afterward.' },
      },
      required: ['keys'],
    },
    action: 'press',
  },
  {
    name: 'kestrel_scroll',
    title: 'Scroll Page',
    description: 'Scroll the page up or down, or until a target text is in view. Use when content is below the fold and missing from the snapshot.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up'], default: 'down' },
        to_text: { type: 'string', description: 'Scroll until this text is visible.' },
      },
    },
    action: 'scroll',
  },
  {
    name: 'kestrel_wait_for',
    title: 'Wait For Condition',
    description: 'Wait for a condition before proceeding: text to appear, a selector, a URL substring, or network idle. Prefer this over fixed sleeps after async actions.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Wait until this text appears.' },
        selector: { type: 'string', description: 'Wait until this CSS selector appears.' },
        url: { type: 'string', description: 'Wait until the URL contains this substring.' },
        networkidle: { type: 'boolean', description: 'Wait until the network is idle.' },
        timeout: { type: 'integer', description: 'Max wait in ms.', default: 15000 },
      },
    },
    action: 'wait_for',
  },
  {
    name: 'kestrel_extract',
    title: 'Extract Data',
    description: 'Extract structured data from the current page using a natural-language query, from the accessibility tree (no vision needed).',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: "What to extract, e.g. 'all product names and prices'." } },
    },
    action: 'extract',
  },
  {
    name: 'kestrel_assert',
    title: 'Assert Page State',
    description: 'Assert the current page state without acting: expected text present, URL match, or a selector visible. Use as a final proof-of-success check after a sequence of actions.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text that should be present on the page.' },
        url: { type: 'string', description: 'Substring the current URL should contain.' },
        selectorVisible: { type: 'string', description: 'CSS selector that should be visible.' },
      },
    },
    action: 'assert',
  },
  {
    name: 'kestrel_screenshot',
    title: 'Screenshot (Vision Fallback)',
    description: 'Capture a PNG screenshot of the page. Use only as a fallback when kestrel_snapshot cannot identify an element (canvas/WebGL UIs). For normal pages, kestrel_snapshot is cheaper and more reliable.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: { fullPage: { type: 'boolean', description: 'Capture the full scrollable page.', default: false } },
    },
    action: 'screenshot',
    screenshot: true,
  },
  {
    name: 'kestrel_tabs',
    title: 'List Tabs',
    description: 'List open browser tabs with their index, URL, and title.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: {} },
    action: 'tabs',
  },
  {
    name: 'kestrel_switch_tab',
    title: 'Switch Tab',
    description: 'Switch the active tab by index (from kestrel_tabs).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { index: { type: 'integer', description: 'Tab index.' } }, required: ['index'] },
    action: 'switch_tab',
  },
  {
    name: 'kestrel_new_tab',
    title: 'New Tab',
    description: 'Open a new tab, optionally navigating to a URL.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'Optional URL to open.' } } },
    action: 'new_tab',
  },
  {
    name: 'kestrel_close_tab',
    title: 'Close Tab',
    description: 'Close a tab by index (defaults to the active tab).',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: { type: 'object', properties: { index: { type: 'integer', description: 'Tab index to close.' } } },
    action: 'close_tab',
  },
  {
    name: 'kestrel_back',
    title: 'Go Back',
    description: 'Navigate back in browser history.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: { type: 'object', properties: {} },
    action: 'back',
  },
  {
    name: 'kestrel_console_log',
    title: 'Console Messages',
    description: 'Return recent browser console messages — useful for diagnosing why an action failed.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', default: 20 } } },
    action: 'console_log',
  },
  {
    name: 'kestrel_network',
    title: 'Network / API Discovery',
    description: "Return recent network requests the page made (xhr/fetch). Use to discover a site's own data API endpoints — often you can read data straight from them instead of scraping the UI.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: "Substring to filter request URLs, e.g. '/api/'." },
        limit: { type: 'integer', default: 30 },
      },
    },
    action: 'network',
  },
  {
    name: 'kestrel_recall',
    title: 'Recall Site Memory',
    description: "Recall what Kestrel learned about a domain on past sessions — selectors, pacing, notes. Call before a complex flow on a site you may have used before.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: 'object', properties: { domain: { type: 'string', description: "Domain, e.g. 'github.com'." } }, required: ['domain'] },
    action: 'recall',
  },
];

/** Fast lookup by tool name. */
export const TOOL_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** The public tool descriptors sent in a tools/list response (no internal fields). */
export function toolList() {
  return TOOLS.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations,
  }));
}
