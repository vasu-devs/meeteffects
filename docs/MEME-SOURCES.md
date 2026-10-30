# MeetEffects: meme asset provenance

Retrieved and checked on 2026-10-27. These are existing captioned reaction images,
downloaded unchanged from Know Your Meme's CDN. They have not been generated,
recaptioned, cropped, resized or recompressed locally. The audio files are existing
Kenney percussion effects, also unmodified. No movie dialogue or imitation voice
is included.

## Integration contract

`extension/meme-assets.js` is a classic-script IIFE assigning
`(globalThis.MeetEffects ||= {}).memeAssets`. Each entry contains `label`, an
`image` JPEG data URL and a `sound` Ogg Vorbis data URL. It preserves an existing
MeetEffects namespace and also works when loaded alone in the isolated panel.
Load it **after engine.js** wherever that script is used: the current engine
initializes the namespace itself. All runtime media bytes are embedded; there
are no runtime network requests, hotlinks or media permissions in this bundle.

| Key | Label | Picture | Sound |
| --- | --- | --- | --- |
| `cinema` | Absolute cinema | Scorsese with raised hands and the existing ABSOLUTE CINEMA caption | Bell impact, 1.480181 s |
| `tired` | I'm tired, boss | John Coffey close-up with the existing dialogue subtitle | Soft impact, 0.505102 s |
| `brb` | This is fine | KC Green's dog sitting in a burning room, first two panels with its speech bubble | Wood impact, 0.332676 s |

`brb` retains the parent's existing effect key but represents **This is fine**,
not a literal away/BRB status. Suggested description: "Dog in a burning room
saying This is fine." All pictures already contain their recognizable captions;
the parent can render them directly while preserving aspect ratio. Playback and
camera rendering are outside this asset bundle.

## Images and provenance

| Local file under `extension/assets/memes/` | Dimensions | Bytes | Exact downloaded URL |
| --- | --- | ---: | --- |
| `absolute-cinema.jpg` | 637 × 893 | 46,486 | [KYM JPEG](https://i.kym-cdn.com/photos/images/newsfeed/002/693/282/5cb) |
| `im-tired-boss.jpg` | 680 × 358 | 15,633 | [KYM JPEG](https://i.kym-cdn.com/photos/images/newsfeed/002/409/966/f17.jpg) |
| `this-is-fine.jpg` | 561 × 265 | 42,003 | [KYM JPEG](https://i.kym-cdn.com/photos/images/newsfeed/001/401/347/312.jpg) |

- **Absolute cinema:** [exact image record](https://knowyourmeme.com/photos/2693282-absolute-cinema),
  [meme provenance](https://knowyourmeme.com/memes/absolute-cinema).
  The reference traces the underlying Martin Scorsese photograph to
  [The New York Times interview, January 2, 2020](https://www.nytimes.com/2020/01/02/movies/martin-scorsese-irishman.html).
  The original article could not be accessed during this research, so the
  photographer and creator of this particular captioned version are unverified.
- **I'm tired, boss:** [exact image record](https://knowyourmeme.com/photos/2409966-im-tired-boss),
  [meme provenance](https://knowyourmeme.com/memes/im-tired-boss).
  Film still from *The Green Mile* (1999), showing Michael Clarke Duncan as
  John Coffey. The actor is identified as the subject, not the image author;
  the creator of this particular subtitled image is unverified.
- **This is fine:** [exact image record](https://knowyourmeme.com/photos/1401347-this-is-fine),
  [meme provenance](https://knowyourmeme.com/memes/this-is-fine),
  [KC Green's original Gunshow comic #648, “On Fire”](https://gunshowcomic.com/648).
  The author's site credits copyright to KC Green. This is the existing two-panel
  reaction image hosted by KYM, not the entire six-panel comic. No local crop was made.

**Image rights:** no open redistribution license was established for these three
images. KYM is the download/reference host, not evidence of permission from the
underlying creators. They originated in the private prototype and remain included in this experimental
project. Publishing this repository does not establish additional rights; this
record makes no claim of public-domain status, redistribution clearance,
or a legal exemption for the images. The audio license below does not cover them.

## Optional percussion audio and attribution

Creator: **Kenney**. Pack: **Impact Sounds 1.0** (2019).
The [creator's pack page](https://kenney.nl/assets/impact-sounds) explicitly lists
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).
The unchanged upstream notice is retained at
`extension/assets/sounds/kenney-impact-sounds-license.txt` (608 bytes).
Credit: “Impact Sounds by Kenney (kenney.nl), CC0 1.0.”

Individual files were obtained through the public
[GeorgeQLe/assets-sfx-combat mirror at commit 9662dc1bed3b06ae753045915f9accfac044c7ce](https://github.com/GeorgeQLe/assets-sfx-combat/tree/9662dc1bed3b06ae753045915f9accfac044c7ce),
using GitHub's file API. This avoided downloading a sound pack archive. The
following raw URLs identify the same pinned files. Each downloaded file was
checked against the mirror's Git blob SHA-1; local SHA-256 pins are in the vendor
script. The retained notice and official creator page both identify CC0.

| File under `extension/assets/sounds/` | Bytes | Duration | Exact pinned raw URL |
| --- | ---: | ---: | --- |
| `impactBell_heavy_000.ogg` | 13,915 | 1.480181 s | [Bell](https://raw.githubusercontent.com/GeorgeQLe/assets-sfx-combat/9662dc1bed3b06ae753045915f9accfac044c7ce/assets/kenney/impact-sounds/Audio/impactBell_heavy_000.ogg) |
| `impactSoft_heavy_000.ogg` | 6,570 | 0.505102 s | [Soft impact](https://raw.githubusercontent.com/GeorgeQLe/assets-sfx-combat/9662dc1bed3b06ae753045915f9accfac044c7ce/assets/kenney/impact-sounds/Audio/impactSoft_heavy_000.ogg) |
| `impactWood_medium_000.ogg` | 6,575 | 0.332676 s | [Wood](https://raw.githubusercontent.com/GeorgeQLe/assets-sfx-combat/9662dc1bed3b06ae753045915f9accfac044c7ce/assets/kenney/impact-sounds/Audio/impactWood_medium_000.ogg) |
| `kenney-impact-sounds-license.txt` | 608 | — | [Original notice](https://raw.githubusercontent.com/GeorgeQLe/assets-sfx-combat/9662dc1bed3b06ae753045915f9accfac044c7ce/LICENSES/kenney-impact-sounds-license.txt) |

Audio format: Ogg Vorbis, stereo, 44,100 Hz. Upstream metadata credits Kenney
and says these effects were generated using GameSynth by Tsugi; these are
published percussion effects, not recorded movie speech. No suitable short movie
quote file was established in the bounded search, so the requested CC0 fallback
was used.

## Reproduction and verification

- `python3 scripts/vendor-memes.py` regenerates the embedded JavaScript from
  checksum-verified local files, offline.
- `python3 scripts/vendor-memes.py --check` verifies all seven raw file sizes,
  SHA-256 hashes and the exact embedded bundle without writing or networking.
- `python3 scripts/vendor-memes.py --download` explicitly refetches only those
  seven bounded individual files and verifies them before writing. Every read is
  limited to the pinned length plus one byte; mismatches fail. No dependencies,
  models, npm packages or archives are downloaded.

Validation performed: all three downloaded images visually inspected; JPEG
dimensions read with ImageMagick; all six media files decoded successfully to
FFmpeg's null sink using one decoder thread. FFprobe confirms every cue is under
five seconds. No browser, build, camera session, source-photo upload or UI change
was used for asset validation.

Raw images total **104,122 bytes**. Raw sounds total **27,060 bytes**.
Images plus sounds total **131,182 bytes**, comfortably within the 1 MiB cap;
each individual image/sound is below 150,000 bytes. The vendor command also
enforces the 3 MiB combined raw-plus-JavaScript budget.
