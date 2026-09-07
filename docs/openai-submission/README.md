# OpenAI submission pack

Prepared September 7, 2026. Status: draft materials; not submitted.

- `listing.md`: copy-ready listing fields, prompts, and initial release notes.
- `review-tests.md`: reviewer setup, positive and negative cases, evidence template.
- `fixtures/`: synthetic OKF documents for a dedicated review repository.
- `../../site/assets/openstore.svg`: original vector logo.

## Portal configuration

Use https://platform.openai.com/plugins → Create plugin → With MCP → Universal.
Name: OpenStore. Server: https://mcp.openstore.sh/mcp. Include the OpenStore skill
in the same submission. Use OAuth for private repository access.

The OpenAI package is in `package/openstore/`, with `.codex-plugin/plugin.json`,
remote MCP wiring, the provider-neutral skill, and the SVG logo. The upload archive
is `openstore-0.4.0.zip`. Plugin and skill validators pass. Submit the endpoint and
include the skill in the same With MCP draft; an existing integration ID is not needed.

## Completed in this preparation

- Correct publisher: Int.Reaction llc; support@openstore.sh forwards through Cloudflare.
- Policy and support pages prepared at /privacy.html, /terms.html, and /support.html.
- Listing, prompts, fixtures, 6 positive cases, and 5 negative cases prepared.
- Corrected write-tool openWorldHint to true because existing repositories can be public.
- 238 tests, typecheck, build, and plugin/skill validation passed.
- OpenAI submission portal opened; it requires sign-in before further portal work.

## Required before submission

- Complete individual or business verification in the publishing OpenAI organization;
  the submitter needs Apps Management write access. Int.Reaction llc is the intended publisher; complete its business verification.
  John Wheeler remains the package author.
- Complete an end-to-end support inbox delivery check.
- Provision a dedicated reviewer GitHub account and synthetic private store. Provide
  credentials only through the portal's designated private field, never in this repo.
  Verify the reviewer can complete sign-in without MFA, SMS, email confirmation,
  or private network access; this has not been demonstrated for our GitHub flow.
- Run every case in `review-tests.md` through an OpenAI client. Public smoke tests
  and local tests do not establish end-to-end OAuth compatibility.
- Verify ownership using the portal-provided token at
  `/.well-known/openai-apps-challenge` on the MCP hostname or an allowed parent origin.
- Run the portal tool scan and resolve any additional review findings.
- Validate OAuth against current review requirements, including any workspace-domain
  restriction requirements (UserInfo, verified email, and scopes). Existing metadata
  must not be assumed sufficient merely because the public smoke tests pass.
- Choose supported countries, upload the logo in a format accepted by the portal,
  review skill scan results, and complete policy attestations.

No accounts, policy commitments, geographic availability, successful review results,
or public policy URLs have been invented in these materials.

## Current evidence

The preceding implementation was checked with 238 local tests and 10 public endpoint
checks. These are historical development checks, not executions of this review pack.
Authenticated OpenAI-client testing and live GitHub refresh-token replay checks remain
pending; see `../client-validation.md` and `../deploy.md`.

## Official references

- [Submission requirements](https://developers.openai.com/plugins/deploy/submission)
- [Claude plugin migration](https://developers.openai.com/plugins/guides/submit-claude-plugin)
