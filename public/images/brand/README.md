# Spaceverse brand mark — Lattice

The sphere is never drawn. Rows of dots on a fixed pitch, offset by half a
pitch every other row, are clipped to a circle — the clip resolves the geometry
into a planet, which is what the renderer does too. One ring crosses at −24°.

The form comes from the technology rather than the subject: a planet as
Three.js actually builds it, not a picture of one.

## Files

| File | Use it for | Size band |
|---|---|---|
| `spaceverse-mark.svg` | The master. Hero, docs, anywhere with room. | **64px and up** |
| `spaceverse-mark-small.svg` | Nav, dock, headers, inline UI. | **16–64px** |
| `spaceverse-mark-mono.svg` | Print, embroidery, partner logo walls, anywhere colour is stripped. | 40px and up |
| `spaceverse-tile.svg` | Mark on its own ground: app icon, install prompt, light backgrounds. | any |
| `spaceverse-icon-180.png` | `apple-touch-icon`. Safari ignores SVG here. | 180px fixed |
| `spaceverse-og.png` | `og:image` / `twitter:image` share card. | 1200×630 fixed |
| `../../favicon.svg` | Browser tab. Same geometry as `spaceverse-tile.svg`. | 16px up |

## The size rule matters

The master and the small cut are **different drawings, not two scales of one
drawing**. Seven rows of 5.4-unit dots on an 11-unit pitch turn to mush below
64px; three rows of 15-unit dots look coarse and empty above it. Scaling either
one outside its band is the one way to make this mark look bad.

Two findings from the size proof are already baked into the small cut, and
undoing either will bring the problem back:

- **The ring must not lead.** In the first version it was the only element
  still standing at 16px and the mark collapsed into a violet smear. The dots
  are the idea, so they carry the most weight and the ring is trimmed to suit —
  the reverse of the master's balance.
- **At three rows, a clip path does nothing.** The master gets its round
  silhouette from clipping a dense field. Ten dots give a clip nothing to
  carve, so they are positioned into the circle by hand (3/4/3 across rows at
  y 28/50/72, held near a 0.86 width-to-height ratio). Each row's `x2` stops on
  its last dot — that is what sets the dot count, not the clip.

## Colour

| Token | Hex | Role |
|---|---|---|
| Accent | `#22D3EE` | The equatorial rows |
| Ring | `#A78BFA` | The ring, only |
| Ink | `#F2F6FF` | Remaining rows, shaded by opacity |
| Ground | `#05070D` | Tile fill |

These are the app's own `--accent`, `--accent-2` and `--text` from
`public/css/liquid-glass-theme.css`. If those move, move these.

`spaceverse-mark-mono.svg` is `currentColor` throughout: inline it and it picks
up the surrounding text colour. Referenced as an `<img src>` it falls back to
`#F2F6FF`, which is right on the app's dark grounds — on a light ground inline
it and set `color: #0A0D16`.

## Where it is wired up

- **Favicon** — `public/favicon.svg`, linked by every page in `views/`. One file.
- **Dock** (`home.html`, `landing.html`) — `.dock-mark` in
  `public/css/liquid-glass.css`, at 32px.
- **Legacy headers** (quiz, the Artemis pair, mission tracker, launches, the
  traffic simulator, astronomical events) — those seven pages each define their
  own `.logo-icon > .logo-planet + .logo-ring` in an inline `<style>`. The mark
  is repainted once at the end of `public/css/liquid-glass-theme.css`, which is
  linked after all of them; the old parts are hidden, not deleted, so nothing
  breaks if those files are edited later.
- **Share cards and iOS icon** — `views/home.html` and `views/landing.html`
  only. The other pages are not entry points and carry no `og:` tags at all.

## Still open

- No `manifest.json`, so there is no installable-PWA icon set (192/512 PNG).
  Worth adding if the app is ever installed to a home screen properly.
- The wordmark is set in Space Grotesk from the page CSS, not drawn. There is
  no locked lockup file — if the logo ever needs to sit on someone else's site,
  it needs one.
