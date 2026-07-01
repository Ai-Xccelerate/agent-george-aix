# Supabase Auth Email Templates (branded)

These are the branded HTML bodies for the auth emails Supabase sends through Resend
(from `noreply@agentgeorge.xyz`). They are **not** wired from code — paste them into the
Supabase dashboard.

## Where to paste

Supabase Dashboard → **Authentication → Emails → Templates**. One template per file:

| File | Supabase template | Live today? |
|------|-------------------|-------------|
| `invite.html` | **Invite user** | ✅ used by Settings → Users |
| `magic-link.html` | **Magic Link** | ✅ used by the sign-in page |
| `reset-password.html` | **Reset Password** | ⏳ no forgot-password flow yet; paste it now so it's ready |

For each: switch the editor to the HTML/source view, replace the whole body, Save.

## Hard rule — do not touch the link

The button href is `{{ .ConfirmationURL }}` **verbatim**. That is the PKCE `?code=` link
your `/auth/callback` route exchanges. Do **not** rebuild it from `{{ .TokenHash }}` /
`{{ .Token }}` — that produces a `token_hash` link that the current callback can't handle
and would break sign-in. Branding changes the chrome around the link, never the link.

## Template variables used

- `{{ .ConfirmationURL }}` — the action link (all three templates).
- `{{ .Data.full_name }}` — invite only; set from the invite action's `data.full_name`.
  Falls back gracefully to a generic greeting if empty.

## Rendering notes

- Table-based layout, all CSS inlined — required for Outlook (getonyx.ai is on M365).
- The purple header uses a solid `background-color` with a CSS gradient layered on top:
  Outlook shows the solid color, modern clients show the gradient.
- The wordmark is HTML text, not an image, so it renders even when a client blocks images.
- After pasting, raise **Authentication → Rate Limits** if you haven't (custom SMTP means
  you own delivery now).
