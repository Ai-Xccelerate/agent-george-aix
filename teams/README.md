# Teams app package

Sideload package for the Onyx Teams bot (`docs/BACKLOG.md` #31).

## Before packaging

1. Replace both `00000000-0000-0000-0000-000000000000` placeholders in
   `manifest.json` (`id` and `bots[0].botId`) with the real Entra app
   registration's Application (client) ID — same value as `TEAMS_APP_ID`.
2. `color.png` / `outline.png` are placeholder icons generated from the
   Onyx ring mark (purple `#6D45F5` fill for color, white silhouette for
   outline). Swap in real brand icons before distributing beyond a personal
   test install — Teams requires `color.png` at 192x192 and `outline.png`
   at 32x32 (mostly transparent, white glyph only).

## Package and sideload

```bash
cd teams
zip -r agent-george-teams.zip manifest.json color.png outline.png
```

Then in Teams Admin Center: **Manage apps → Upload new app → Upload** (org
catalog — this is internal-only distribution, not an AppSource submission).
Onyx's Teams admin does this step, not us.
