# OpenStore Privacy Policy

Effective September 7, 2026.
Operator: Int.Reaction llc. Privacy contact: [support@openstore.sh](mailto:support@openstore.sh).

## Scope

This policy covers the OpenStore website at openstore.sh and the hosted MCP service
at mcp.openstore.sh. It does not describe an independently operated self-hosted
instance, GitHub's own service, or the AI client you choose.

OpenStore connects your AI client to a GitHub repository. The hosted application
processes requests in memory and does not maintain a database of your notes or
user credentials. This does not mean that no personal information passes through
the service or that our infrastructure providers retain nothing.

## Information processed and why

- **Connection information:** During sign-in and requests, OpenStore processes GitHub
  access and refresh tokens, authorization codes, GitHub login and installation
  information, accessible repository identifiers, client identifiers, redirect
  addresses, and requested permissions. This enables sign-in, repository selection,
  and authorized operations. Tokens are processed transiently, not saved in an
  OpenStore user-token database. Encrypted connection credentials are returned to
  and retained by your client; temporary encrypted setup information also passes
  through your browser. These credentials remain sensitive even when encrypted.
- **Repository information:** OpenStore reads file paths, text, metadata, and Git
  history, and processes the content of requested edits. It passes results to your
  connected client and commits authorized mutations to GitHub. Our application
  does not persist repository content or use it to train models or target advertising.
- **Network information:** Hosting and network providers necessarily process requests
  and connection information such as IP addresses and request metadata to deliver
  and protect the website and API. Persisted Worker invocation logs and traces are
  disabled in our current configuration. Cloudflare Network Error Logging remains
  enabled separately and may collect browser network diagnostics. Provider telemetry
  is not covered by our application's no-storage design.
- **Support messages:** If you contact us, we receive what you send and your contact
  details to answer you, investigate problems, and handle rights requests. Do not
  include credentials or private repository contents. Public GitHub issues are public.

## Services involved

GitHub authenticates you and stores repositories, commits, and history. GitHub Pages
hosts our public website. Cloudflare runs the hosted MCP endpoint and related network
services. Support email is forwarded by Cloudflare Email Routing to our support
mailbox; our mailbox provider processes and stores that correspondence. Your chosen AI client receives tool results and holds connection credentials;
its own storage, model processing, and retention practices apply.

Review the [GitHub privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement),
[Cloudflare privacy policy](https://www.cloudflare.com/privacypolicy/), and your AI
provider's privacy settings and policy. Processing can occur in the countries where
these services operate; OpenStore does not promise a particular data-residency region.

We do not sell repository content or use it for cross-context behavioral advertising.
We disclose information as necessary to carry out your requests through these services,
respond to valid legal requirements, or protect the service and people's rights.
We cannot provide stored notes or user tokens that we do not possess.

## Retention and your control

Application processing lasts for the request; we do not keep an application-side
archive of notes or user credentials. Infrastructure providers may retain operational
information under their own policies. Support correspondence is kept only as needed
to resolve the request and meet applicable legal obligations; it is separate from the
stateless MCP request path.

You can read, export, edit, or delete your files directly through GitHub. Removing a
file or reverting a commit does not erase its earlier versions from Git history,
clones, backups, or an AI client's conversation. GitHub and client retention must be
managed with those providers.

To stop future access, revoke the GitHub App authorization or installation access
and disconnect the client. Client logout alone may not revoke GitHub credentials.
GitHub controls when revocation is enforced. OpenStore cannot erase content a client
already received.

## Cookies and security

The current OpenStore website does not include advertising or analytics scripts, and
the application does not create a persistent server-side login session. GitHub,
Cloudflare, and your client may use cookies or other storage under their own policies.
HTTPS and encrypted connection envelopes protect data in transit and client-held
connection information. The hosted service decrypts credentials to perform requests;
this is not end-to-end encryption that hides content from the server while processing.
No system can guarantee complete security. Keep passwords and API secrets out of notes.

## Rights and requests

Depending on applicable law, you may have rights to access, correct, delete, or receive
a copy of personal information, or to object to or restrict processing. Contact the
privacy address above. We may ask for information needed to verify the request. You
may also complain to your applicable data protection authority. For records controlled
by GitHub or your AI provider, use their rights-request channels as well.

Where a legal basis is required, we process information needed to deliver the service
you request, protect its operation, answer correspondence, and meet legal obligations;
we obtain consent where required. This policy does not waive statutory rights or
establish that every jurisdiction's requirements have been met.

The service is not directed to children. Contact us if you believe a child has sent
us personal information so we can address information within our control.

## Changes

We will update the date and publish revisions here. Material changes will be identified
on the website, with additional notice or consent where required by law.

## Attribution and license

Adapted with substantial changes from Automattic's
[Legalmattic Privacy Policy](https://github.com/Automattic/legalmattic/blob/master/Privacy-Policy.md).
Automattic does not endorse OpenStore. This policy text and our adaptations are
licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), including
that license's disclaimer of warranties. This document license does not grant rights
to users' repository content or change the software's Apache-2.0 license.
