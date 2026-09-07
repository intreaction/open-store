# Support email

Configured September 7, 2026 in Cloudflare Email Routing:

- Address: support@openstore.sh
- Destination: john@intreaction.com (already verified in Cloudflare)
- Rule ID: 4e511e6e7f4d459cb6deb62d410bc1ff
- Zone: openstore.sh
- Exact-address forwarding enabled; catch-all remains disabled.
- Cloudflare reports enabled, synced, and ready.
- Public DNS-over-HTTPS verified three Cloudflare MX records and the Cloudflare SPF record.
- End-to-end delivery to the destination inbox has not been tested.

This configures incoming forwarding, not outbound sending as support@openstore.sh.
Support correspondence is separate from the stateless MCP request path and can be
stored by the destination mailbox provider. The privacy draft reflects this.
