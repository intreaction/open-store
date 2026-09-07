/** The five pages the hosted flow can show. Markup only; no fetching, no state. */
import type { RepoRef } from '../oauth/github.js';
import { escapeAttr, html, page, raw, safeUrl, type SafeHtml } from './html.js';

export function homePage(args: { origin: string; siteUrl: string }): string {
  const mcpUrl = `${args.origin}/mcp`;
  return page({
    title: 'Endpoint',
    siteUrl: args.siteUrl,
    body: html`<h1>This is an OpenStore endpoint.</h1>
<p class="sub">It gives an AI client bash&#8209;like tools &mdash; <code>grep</code>, <code>cat</code>,
<code>write</code>, <code>git_log</code> &mdash; over one private GitHub repository of Markdown that
you own. There is nothing to click here; your AI client drives it.</p>
<div class="card">
<h2 style="margin-top:0">Add it to your AI</h2>
<p class="sub">Point a Model Context Protocol client at this URL and sign in with GitHub when it
asks. The read&#8209;only variant is the same URL with <code>/readonly</code> on the end.</p>
<p><code>${mcpUrl}</code></p>
</div>
<h2>What happens when you sign in</h2>
<ol>
<li>GitHub asks whether to let the OpenStore app act for you.</li>
<li>OpenStore offers to create a private <code>my-openstore</code> repository from the public
template, or to use a repository you already have.</li>
<li>Your client gets a token that reaches that one repository and nothing else.</li>
</ol>
<h2>What this server never sees</h2>
<p class="sub">Nothing is stored. Your GitHub token travels inside an encrypted token your client
holds and is decrypted only for the length of one request. Logs record a route, a tool name, a status
and a byte count &mdash; never your content, never a token.</p>`
  });
}

export function installPage(args: {
  installUrl: string;
  siteUrl: string;
  accountHint?: string;
}): string {
  return page({
    title: 'Install OpenStore',
    siteUrl: args.siteUrl,
    body: html`<h1>Install OpenStore on your GitHub account</h1>
<p class="sub">One more step. OpenStore reaches your store through a GitHub App, so GitHub &mdash; not
this server &mdash; decides exactly which repositories it can touch. Install it, choose where, and
GitHub will send you straight back here.</p>
<div class="card">
<p style="margin-bottom:.4rem"><strong>What the app asks for</strong></p>
<p class="sub" style="margin-bottom:0">Repository contents (read and write) so it can read and commit
your notes, repository administration (write) so it can create the store repository for you, and
metadata (read). Nothing else. You pick the repositories.</p>
</div>
<p><a class="cta" href="${raw(escapeAttr(safeUrl(args.installUrl)))}">Install on GitHub</a></p>
${args.accountHint ? html`<p class="tag">Signed in as ${args.accountHint}.</p>` : ''}`
  });
}

export interface SetupPageArgs {
  pickToken: string;
  repos: RepoRef[];
  defaultName: string;
  siteUrl: string;
  /** Set when the state already forced read-only, so the checkbox is shown as fixed. */
  forcedReadonly: boolean;
  /** The registered name of the client that started this connection. */
  clientName?: string;
  /** Host the authorization code will be sent to, or "this computer" for loopback. */
  clientHost?: string;
  error?: string;
}

export function setupPage(args: SetupPageArgs): string {
  const repos = args.repos.map((repo) => `${repo.owner}/${repo.name}`).sort();
  const repoList: SafeHtml =
    repos.length > 0
      ? html`<div class="repos">${repos.map(
          (name, index) =>
            html`<label><input type="radio" name="repo" value="${name}"${
              index === 0 ? raw(' checked') : ''
            }><span>${name}</span></label>`
        )}</div>`
      : html`<div class="repos"><p class="empty">The OpenStore app does not have access to any
repository yet. Create one above, or grant it access on GitHub and reconnect.</p></div>`;

  return page({
    title: 'Create your store',
    siteUrl: args.siteUrl,
    body: html`<h1>Create your OpenStore</h1>
<p class="sub">A new private repository on your GitHub account, made from the public OpenStore
template. It is yours: readable, editable and deletable by you, at any time, with or without any AI.</p>
${
  args.clientName || args.clientHost
    ? html`<p class="tag">Connecting <strong>${args.clientName ?? 'an MCP client'}</strong>${
        args.clientHost ? html` at <code>${args.clientHost}</code>` : ''
      }. If you did not just ask an AI client to connect, close this tab &mdash; nothing has been
created and nothing has been shared.</p>`
    : ''
}
${args.error ? html`<p class="err">${args.error}</p>` : ''}
<form method="post" action="/callback/setup" class="card">
<input type="hidden" name="pick" value="${args.pickToken}">
<label for="name">Repository name</label>
<input type="text" id="name" name="name" value="${args.defaultName}" spellcheck="false"
 autocapitalize="off" autocorrect="off" pattern="[A-Za-z0-9._-]{1,90}" required>
<p class="tag" style="margin:.45rem 0 0">Private. Created from
<code>intreaction/openstore-template</code>.</p>
<button class="primary" type="submit" name="action" value="create">Create my OpenStore</button>

<details${args.error ? raw(' open') : ''}>
<summary>Advanced &mdash; use a repository I already have</summary>
${repoList}
<div class="check"><label><input type="checkbox" name="readonly" value="1"${
      args.forcedReadonly ? raw(' checked disabled') : ''
    }><span>Read&#8209;only access &mdash; the AI can search and read the store but never write to it.</span></label></div>
${
  args.forcedReadonly
    ? html`<p class="tag">Your client asked for read&#8209;only access, so this is already fixed.</p>`
    : ''
}
<button class="secondary" type="submit" name="action" value="existing" formnovalidate>Use the selected repository</button>
</details>
</form>`
  });
}

export interface ConfirmPageArgs {
  pickToken: string;
  /** `owner/name` of the store we found for this user. */
  repo: string;
  readonly: boolean;
  siteUrl: string;
  /** The registered name of the client that started this connection. */
  clientName?: string;
  /** Host the authorization code will be sent to, or "this computer" for loopback. */
  clientHost?: string;
}

/**
 * The returning user's one click. We know which repository is their store, so
 * there is nothing to choose — but registration is open to anyone, so a token is
 * never issued without the user seeing who asked for it and saying yes.
 */
export function confirmPage(args: ConfirmPageArgs): string {
  const client = args.clientName ?? 'an MCP client';
  return page({
    title: `Connect to ${client}`,
    siteUrl: args.siteUrl,
    body: html`<h1>Connect to ${client}</h1>
<p class="sub">You already have an OpenStore. One click gives this client a token for that one
repository and nothing else. Nothing has been shared yet.</p>
<div class="card">
<p style="margin-bottom:.35rem"><strong>${client}</strong>${
      args.clientHost ? html` at <code>${args.clientHost}</code>` : ''
    } is connecting.</p>
<p class="sub" style="margin-bottom:1.1rem">Any client can register that name, so check it is the one
you just used.</p>
<p style="margin-bottom:.35rem"><strong>Store</strong> <code>${args.repo}</code></p>
<p class="sub" style="margin-bottom:0">${
      args.readonly
        ? 'Read-only access. The AI can search and read this store but never write to it.'
        : 'Read and write access. The AI can read this store and commit changes to it.'
    }</p>
<form method="post" action="/callback/confirm">
<input type="hidden" name="pick" value="${args.pickToken}">
<input type="hidden" name="repo" value="${args.repo}">
<button class="primary" type="submit" name="action" value="connect">Connect to ${client}</button>
<div><button class="link" type="submit" name="action" value="choose">Use a different repository</button></div>
</form>
</div>
<p class="tag">If you did not just ask an AI client to connect, close this tab. Nothing has been
shared and nothing has been created.</p>`
  });
}

export function grantAccessPage(args: {
  pickToken: string;
  repo: string;
  settingsUrl: string;
  siteUrl: string;
}): string {
  return page({
    title: 'Grant access',
    siteUrl: args.siteUrl,
    body: html`<h1>Almost there &mdash; let the app see it</h1>
<p class="sub"><code>${args.repo}</code> exists now. Your OpenStore installation is limited to
selected repositories, and GitHub only lets <em>you</em> add one to that list. Open the installation
settings, add the new repository, then come back and continue.</p>
<p><a class="cta" href="${raw(escapeAttr(safeUrl(args.settingsUrl)))}">Open installation settings</a></p>
<form method="post" action="/callback/setup" style="margin-top:1.4rem">
<input type="hidden" name="pick" value="${args.pickToken}">
<button class="secondary" type="submit" name="action" value="continue">I have added it &mdash; continue</button>
</form>`
  });
}
