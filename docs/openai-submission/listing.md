# OpenStore listing

Draft for the OpenAI plugin portal. Copy fields below after resolving the pending
items in `README.md`. No submission or approval is implied.

## Name

OpenStore

## Short description

AI memory you own. Save and recall knowledge in your GitHub repository.

## Long description

Keep useful context beyond a single conversation. OpenStore lets your AI search,
read, and update knowledge in a GitHub repository you control.

Sign in with GitHub and create a private `my-openstore` repository, or connect an
existing repository. New stores start with a minimal Open Knowledge Format (OKF)
index and README. Add knowledge as you need it, without preset folders or sample
personal facts.

Ask your AI to remember a project decision, find a preference you saved, or correct
an outdated note. Changes are recorded in Git, so you can inspect their history and
undo supported changes with a new commit. A read-only connection is also available.

Your notes remain ordinary Markdown you can edit, export, and use independently.
OpenStore passes requests through to GitHub without application-side storage of
repository content or user credentials. Your AI client retains connection credentials
and processes the content it retrieves; GitHub stores your files and history.

Requires a GitHub account and authorization for the selected repository. Deleting a
file does not remove it from Git history. OpenStore is for knowledge, not passwords,
API keys, or other secrets.

## Category

Productivity (choose the closest available portal category).

## Website

https://openstore.sh/

## Source repository

https://github.com/intreaction/openstore

## Logo

`../../site/assets/openstore.svg` — 512 × 512 SVG, open box and document, forest green,
sage, and ivory. Uses no fonts, external assets, scripts, or embedded images.
If the portal requires a raster upload, export this master at the required dimensions.

## Support, privacy, and terms

Publisher: Int.Reaction llc.

- Support: https://openstore.sh/support.html
- Contact: support@openstore.sh
- Privacy: https://openstore.sh/privacy.html
- Terms: https://openstore.sh/terms.html

Policies are effective September 7, 2026. Cloudflare forwarding is enabled;
end-to-end inbox delivery testing remains pending.

## Starter prompts

- What have I saved about my current projects?
- Remember that I prefer project updates with a short summary followed by next steps.
- Find my notes about the Atlas project and summarize the decisions.
- Update my saved preference: use Celsius when discussing temperatures.
- Show the most recent change to my notes and explain what it changed.
- Undo the specific note change I just approved.

## Initial release notes

Initial OpenAI submission of OpenStore, combining a remote MCP server with a skill
for searching and maintaining user-owned knowledge. New repositories use a minimal
OKF starter. Supports reads, guarded writes, commit history, reverts, and read-only
connections. Client and authenticated review results must be attached before submission.

## Copy alternatives

Alternative short description: Keep your AI’s useful context in Markdown you control.

Connection CTA: Connect with GitHub.
Alternative CTA: Connect your knowledge.

Copy rationale: lead with ownership and recall, then explain GitHub and OKF. Avoid
promising that AI vendors retain nothing, that deletion erases history, or that all
clients enforce the same approval behavior.
