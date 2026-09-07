/**
 * Every page this server renders. Small, self-contained, no scripts, no external
 * requests, light and dark through `prefers-color-scheme`.
 *
 * Rule: nothing from a request, a token or GitHub is ever interpolated without
 * going through {@link escapeHtml} or {@link escapeAttr}. `html` is the only
 * function allowed to build markup, and it escapes every interpolated value.
 */

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Attribute values get the same treatment; kept separate for readability at call sites. */
export const escapeAttr = escapeHtml;

/** Marks a string as already-safe markup, so nested templates compose. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/** Tagged template that escapes every interpolation unless it is already SafeHtml. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value instanceof SafeHtml) out += value.value;
    else if (Array.isArray(value)) {
      out += value.map((item) => (item instanceof SafeHtml ? item.value : escapeHtml(item))).join('');
    } else if (value === null || value === undefined || value === false) out += '';
    else out += escapeHtml(value);
    out += strings[i + 1] ?? '';
  }
  return new SafeHtml(out);
}

/**
 * Only ever used on URLs we build ourselves or that came from GitHub's API.
 * Anything not http(s) is dropped rather than rendered.
 */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '#';
    return parsed.toString();
  } catch {
    return '#';
  }
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fbfaf8;--panel:#ffffff;--ink:#1b1a17;--muted:#5d5a52;
--line:#e3ded4;--accent:#1f6f4a;--accent-ink:#ffffff;--warn:#8a3b12}
@media (prefers-color-scheme:dark){:root{--bg:#131311;--panel:#1c1c19;--ink:#f0ede6;--muted:#a49f93;
--line:#2f2e2a;--accent:#4fbf87;--accent-ink:#0b1a12;--warn:#e0925c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif}
main{max-width:41rem;margin:0 auto;padding:3rem 1.25rem 4rem}
.brand{font-weight:640;letter-spacing:-.01em;font-size:.9rem;color:var(--muted);
text-transform:uppercase;letter-spacing:.09em;margin:0 0 1.4rem}
h1{font-size:1.75rem;line-height:1.2;letter-spacing:-.02em;margin:0 0 .6rem}
h2{font-size:1.02rem;letter-spacing:-.01em;margin:2rem 0 .5rem}
p{margin:0 0 1rem;color:var(--ink)}
p.sub{color:var(--muted)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.5rem}
label{display:block;font-weight:600;font-size:.9rem;margin:0 0 .35rem}
input[type=text]{width:100%;padding:.65rem .75rem;font:inherit;color:inherit;
background:var(--bg);border:1px solid var(--line);border-radius:9px}
input[type=text]:focus{outline:2px solid var(--accent);outline-offset:1px}
button{font:inherit;font-weight:620;cursor:pointer;border-radius:10px;border:1px solid transparent;
padding:.8rem 1.15rem}
button.primary{width:100%;background:var(--accent);color:var(--accent-ink);font-size:1.05rem;
padding:.95rem 1.15rem;margin-top:1.1rem}
button.secondary{background:transparent;color:var(--ink);border-color:var(--line);margin-top:.9rem}
button.link{background:none;border:none;padding:0;margin:1rem 0 0;font-size:.94rem;
color:var(--accent);text-decoration:underline;text-underline-offset:.18em}
details{margin-top:1.6rem;border-top:1px solid var(--line);padding-top:1rem}
summary{cursor:pointer;font-weight:600;font-size:.94rem;color:var(--muted)}
summary::marker{color:var(--muted)}
details[open] summary{margin-bottom:.9rem}
.repos{max-height:17rem;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:.25rem}
.repos label,.check label{display:flex;gap:.6rem;align-items:baseline;font-weight:400;
padding:.45rem .55rem;border-radius:7px;margin:0}
.repos label:hover{background:var(--bg)}
.repos .empty{padding:.7rem .6rem;color:var(--muted);font-size:.9rem}
.check{margin-top:.9rem}
.tag{font-size:.78rem;color:var(--muted)}
code{font:.88em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);
border:1px solid var(--line);border-radius:5px;padding:.1em .38em}
a{color:var(--accent)}
.cta{display:inline-block;background:var(--accent);color:var(--accent-ink);text-decoration:none;
font-weight:640;padding:.85rem 1.3rem;border-radius:10px;margin:.4rem 0 .2rem}
ol{padding-left:1.15rem}ol li{margin-bottom:.4rem}
.err{color:var(--warn);font-weight:600}
footer{margin-top:2.6rem;padding-top:1.1rem;border-top:1px solid var(--line);
color:var(--muted);font-size:.86rem}
footer p{color:var(--muted);margin:0 0 .5rem}
`;

export interface PageOptions {
  title: string;
  body: SafeHtml;
  siteUrl?: string;
}

/** Wraps a body in the shared shell. The trust statement lives in the footer of every page. */
export function page(options: PageOptions): string {
  const site = safeUrl(options.siteUrl ?? 'https://github.com/intreaction/open-store');
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(options.title)} · OpenStore</title>
<style>${STYLE}</style>
<main>
<p class="brand">OpenStore</p>
${options.body.value}
<footer>
<p>OpenStore keeps nothing. No database, no cache, no logs of your content &mdash; your store is a
Git repository you own, and this server is a pass&#8209;through that forgets every request the moment
it answers.</p>
<p><a href="${escapeAttr(site)}">About OpenStore</a></p>
</footer>
</main>
`;
}

/**
 * These pages carry sealed tokens in hidden form fields, so they are locked down
 * hard: no script may run (there is none to run), no other page may frame them,
 * nothing is cached, and no referrer carries the query string onward. The policy
 * is a second lock behind {@link html}'s escaping — if an escape ever leaked, an
 * injected script still could not execute or exfiltrate the sealed token.
 *
 * `form-action` is deliberately absent: the setup form's POST answers with a 302
 * to the client's redirect_uri, and browsers disagree about whether that redirect
 * is checked against the policy.
 */
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'"
} as const;

export function htmlResponse(body: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS,
      ...extraHeaders
    }
  });
}

/** A user-facing failure page. Never carries a stack trace, a token or a query string. */
export function errorPage(args: {
  title: string;
  heading: string;
  detail: string;
  retryUrl?: string;
  retryLabel?: string;
  siteUrl?: string;
}): string {
  return page({
    title: args.title,
    ...(args.siteUrl ? { siteUrl: args.siteUrl } : {}),
    body: html`<h1>${args.heading}</h1>
<p class="sub">${args.detail}</p>
${
  args.retryUrl
    ? html`<p><a class="cta" href="${raw(escapeAttr(safeUrl(args.retryUrl)))}">${
        args.retryLabel ?? 'Try again'
      }</a></p>`
    : html`<p class="sub">Close this tab and start the connection again from your AI client.</p>`
}`
  });
}
