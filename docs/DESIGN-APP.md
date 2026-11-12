# capable: design brief

Planner-owned. This brief is drawn from the owner's reference, Sui's Beep
(app.justbeep.it / justbeep.it). The screenshots are at `/home/claude/design-ref/`
(`beep-signin.png`, `beep-sections.png`, `beep-illustration.png`). Open them
with the Read tool. They are references only: never ship them, and never copy
Beep's logo, wordmark or artwork. Take the *language*, not the brand.

## The feel

Playful and confident: chunky, sticker-like objects with hard shadows, and
four candy colours on warm off-white. It reads as an app made by people, not a
document. Every screen should feel like something you can grab.

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F7F4EA` (warm off-white) | page and card base |
| `--ink` | `#161616` | text, outlines, hard shadows |
| `--cyan` | `#18C8F0` | trait *sovereign* |
| `--magenta` | `#FF1FC8` (hero text: `#FF2BB0`) | trait *civil*, primary actions |
| `--lime` | `#5CF27E` | trait *mobile* |
| `--yellow` | `#FFE11A` | trait *enduring* |
| `--confetti` | `#E4DDF7`, `#F7D9EF`, `#DDEBFA` | scattered pixel squares (6–10px) |
| outline | 3px solid `--ink` (2px under 360px wide) | every card, button, chip, frame |
| hard shadow | `6px 6px 0 var(--ink)` (pressed: `2px 2px 0`, translate 4px) | cards, buttons |
| radius | 22px for cards, 18px for buttons, 0 for colour chips | |

Trait colours come from `trait.hue` in the App. The four current hues map to
the four candies above; any new trait gets a hue and a lightness that suits a
candy colour.

## Type: four voices, used deliberately

- **Shout** (cover titles, the trait you earned): *Archivo* at weight 900,
  `font-stretch: 125%` (wide), ALL CAPS, tight leading (0.92). The key word
  is in the trait colour, given a 2px `--ink` outline via `paint-order: stroke`
  or a stacked text-shadow, the way Beep sets "INVESTED."
- **Pixel** (section labels, the card-type eyebrow, progress, "// lesson 3"):
  *Pixelify Sans* at 600, lowercase, preceded by `//`.
- **Accent** (one line per screen at most, e.g. the promise or the question):
  *Playfair Display* at 700, italic, large.
- **Mono** (credits, small print, "by @papa", "original ↗", step numbers):
  *Space Mono* at 700.
- **Body** (idea and story text): *Inter* at 500–600 and 19–22px on phones,
  short lines.

Load all of them from Google Fonts with `display=swap`, and set fallback
metrics so nothing shifts.

## Components

- **Swipe card**: a rounded, outlined panel with a hard shadow, filling the
  viewport inside a 14px margin. The next card peeks 10px on the right as a
  stacked-paper hint. A card-type eyebrow in Pixel sits at the top left
  (`// idea`, `// story`, `// a word`, `// but`, `// do this`, `// watch`,
  `// more`).
- **Colour chip**: a solid trait-colour rectangle, square corners, Inter
  text. Use it for term titles and trait names, like Beep's "Capabilities"
  and "Prediction markets".
- **Buttons**: outlined pills with a hard shadow. The primary is magenta with
  white Archivo text; secondaries are white. Pressing one sinks it into its
  shadow.
- **Progress**: chunky segments with outlines across the top. Finished
  segments are filled in the trait colour; the current one fills as you read.
- **Video frame**: a 9:16 frame with the same outline and shadow, and
  rounded corners. A mono credit strip sits under it: "by @papa · original ↗".
- **Pixel confetti**: 6–12 tiny squares per screen, placed at random but
  seeded by the card id so they don't move. Never put them over text.
- **Logo**: the word **capable** set in chunky blob letters, each a different
  candy colour, in the spirit of Beep's logo but our own shapes. Build it as
  SVG, from rounded rectangles and circles per letter.

## Rendered art

Each lesson gets a two-tone illustration in a screenprint style, like Beep's
orange-and-slate street scene:
- one flat trait colour, plus ink line work and one desaturated slate (`#5B6488`);
- a grain or halftone texture (an SVG `feTurbulence` plus a threshold, or a
  dither pattern);
- inside an outlined, rounded frame.

Hand-build each scene as SVG from simple shapes. Each is a small, legible
picture of the idea:

| Lesson | Scene |
| --- | --- |
| own-your-exit | a door ajar in a wall, a key, a figure carrying a small bag out |
| friend-speech | two figures at a table, a raised hand turned into an open palm |
| vote-with-your-feet | footprints leading between three small towns of different colours |
| what-lasts | a row of plain houses and a workshop under a big sun, one empty lot |
| draft or new lesson | a generic "seed" scene: a sprout in a pot |

The art appears on the cover card and the lesson tile on home. The trait card
shows the trait chip and the **capable** blob logo filling in.

## Home

- At the top, the **capable** logo and one Shout line: "BECOME
  **CAPABLE**." with CAPABLE in magenta with an outline.
- An Accent line under it: "*one idea at a time*".
- Lessons as tall stacked tiles, each with:
  - its illustration;
  - the title in Shout;
  - the promise;
  - a trait chip;
  - minutes in Mono;
  - progress.
- A "you" panel: four trait chips that fill in as lessons are finished, and
  a count in Pixel ("2 of 4").

## Motion

Snappy, not floaty:
- **Cards:** follow the finger and spring back. They exit with a slight
  rotation of about 3°, like dealt cards.
- **Buttons:** press into their shadow.
- **Confetti:** jiggles once when a trait is earned.
- **Reduced motion:** crossfades only.

## Avoid

- Cream with serif book typography, which reads as "Claude-like" (the
  owner's words).
- Soft shadows and gradients other than the art grain.
- Glassmorphism.
- More than two of the four type voices plus body on one card.
