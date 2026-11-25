# THIRD_PARTY_NOTICES.md

This file lists all third-party components bundled, depended on, or invoked by
FacelessPro, with their licences and attributions. It is the single source for
legal compliance and is generated from the dependency audits in
`docs/11-legal-and-compliance.md`.

---

## Runtime Dependencies (npm)

These are the production dependencies that ship in the Docker images.

| Package | Version | Licence | Repository | Used By |
|---|---|---|---|---|
| `@hono/node-server` | 2.1.8 | MIT | https://github.com/honojs/hono | api, mcp |
| `hono` | 4.13.14 | MIT | https://github.com/honojs/hono | api, mcp |
| `@resvg/resvg-js` | 2.6.2 | MPL-2.0 | https://github.com/RazrFalcon/resvg | art |
| `fontkit` | 2.0.4 | MIT | https://github.com/foliojs/fontkit | art |
| `harfbuzzjs` | 1.6.4 | MIT | https://github.com/kernjs/harfbuzzjs | art |
| `drizzle-orm` | 0.45.4 | MIT | https://github.com/drizzle-team/drizzle-orm | db, queue, render, worker |
| `pg` | 8.23.1 | MIT | https://github.com/brianc/node-postgres | db, queue |
| `pg-boss` | 10.3.2 | MIT | https://github.com/pg-boss/pg-boss | queue |
| `zod` | 4.1.0 | MIT | https://github.com/colinhacks/zod | contracts |

---

## Development Dependencies (npm)

These are **not** bundled in production images.

| Package | Version | Licence | Repository |
|---|---|---|---|
| `typescript` | 5.9.0 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| `tsx` | 4.20.0 | MIT | https://github.com/privatenumber/tsx |
| `esbuild` | 0.25.0 | MIT | https://github.com/evanw/esbuild |
| `vitest` | 5.0.5 | MIT | https://github.com/vitest-dev/vitest |
| `eslint` | 10.13.0 | MIT | https://github.com/eslint/eslint |
| `typescript-eslint` | 8.72.1 | MIT | https://github.com/typescript-eslint/typescript-eslint |
| `drizzle-kit` | 0.31.11 | MIT | https://github.com/drizzle-team/drizzle-kit |
| `@playwright/test` | 1.65.0 | Apache-2.0 | https://github.com/microsoft/playwright |
| `@axe-core/playwright` | 4.11.0 | MPL-2.0 | https://github.com/dequelabs/axe-core |
| `@types/pg` | 8.23.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

---

## Python Service Dependencies (`services/media`)

| Package | Version | Licence | Repository | Notes |
|---|---|---|---|---|
| `edge-tts` | 7.3.1 | MIT | https://github.com/rany2/edge-tts | ⚠️ **Launch blocker** — client talks to Microsoft's consumer Read Aloud endpoint; not a public API. Personal/dev use only. Replace with a licensed engine for public deployment. |
| `fastapi` | 0.162.0 | MIT | https://github.com/fastapi/fastapi | |
| `pydantic` | 2.14.1 | MIT | https://github.com/pydantic/pydantic | |
| `uvicorn` | 0.54.0 | BSD-3-Clause | https://github.com/encode/uvicorn | |

---

## Bundled Fonts (`packages/art/fonts/ttf/`)

All fonts are from the **Google Fonts** project, licensed under the **SIL Open Font License 1.1**.
The full OFL text is included below. Upstream source: <https://github.com/google/fonts>
Pinned revision: `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec` (2024-01-15).

| Local File | Upstream Family | SHA-256 | OFL Text |
|---|---|---|---|
| `ttf/NotoSansTamil-Variable.ttf` | Noto Sans Tamil (Variable: wdth, wght) | `aa3a9b321f4b0bb2c40203ffbde9af89713227866e0e13f76e5b9eeea727cf88` | `OFL-NotoSansTamil.txt` |
| `ttf/NotoSans-Variable.ttf` | Noto Sans (Variable: wdth, wght) | `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` | `OFL-NotoSans.txt` |
| `ttf/NotoEmoji-Variable.ttf` | Noto Emoji (Variable: wght) | `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551` | `OFL-NotoEmoji.txt` |

### SIL OPEN FONT LICENSE Version 1.1 (full text)

```
Copyright 2022 The Noto Project Authors (https://github.com/notofonts)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://scripts.sil.org/OFL

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components
as distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting — in part or in whole — any of the components of the
Original Version, by changing formats or by porting the Font Software to
a new platform.

"Author" refers to any designer, engineer, programmer, technical writer
or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining a
copy of the Font Software, to use, study, modify, merge, embed,
redistribute and sell copies of the Font Software subject to the
following conditions:

1) Neither the Font Software nor any of its individual components, in
Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or in
the appropriate machine-readable metadata fields within text or binary
files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any Modified
Version, except to acknowledge the contribution(s) of the Copyright
Holder(s) and the Author(s) or with their explicit written permission.

5) The Font Software, modified or unmodified, in part or in whole, must
be distributed entirely under this license, and must not be distributed
under any other license. The requirement for fonts to remain under this
license does not apply to any document created using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, TRADEMARK, OR OTHER RIGHTS. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE FONT SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE FONT SOFTWARE.
```

---

## System Dependencies

These are installed in the Docker base images and are not bundled by npm.

| Component | Version | Licence | Notes |
|---|---|---|---|
| `node` | 22-alpine | MIT | Runtime for all JS services |
| `ffmpeg` | 7.x (Alpine package) | LGPL-2.1-or-later / GPL-2.0-or-later | Build uses `--disable-gpl` (LGPL only). If GPL build is used, the media container must comply with GPL. |
| `libstdc++` | 13.x (Alpine) | GPL-3.0-with-GCC-exception | Standard C++ library |
| `python3` | 3.14 (in media image) | PSF-2.0 | Runtime for media service |
| `postgresql` | 16 (Alpine) | PostgreSQL | Database (not bundled in app images) |

---

## Transitive Licences of Note

| Component | Licence | Why it matters |
|---|---|---|
| `zod` v4 | MIT | Schema validation in contracts |
| `resvg-js` | MPL-2.0 | SVG rendering; MPL requires source availability for modified files |
| `fontkit` | MIT | Font subsetting for ASS captions |
| `harfbuzzjs` | MIT | HarfBuzz WASM build for Tamil shaping |
| `pg-boss` | MIT | Job queue on Postgres |
| `drizzle-orm` | MIT | Type-safe SQL |
| `hono` | MIT | Web framework |
| `uvicorn` | BSD-3-Clause | ASGI server for media service |

---

## Assets & Models (not in repo, but invoked at runtime)

| Asset | Source | Licence | Status |
|---|---|---|---|
| Microsoft Edge TTS voices (`ta-IN-ValluvarNeural`, `ta-IN-PallaviNeural`, etc.) | Azure Cognitive Services / Edge Read Aloud | Not a public API; personal use only | ⚠️ **Launch blocker** — must be replaced by a licensed TTS engine (Piper, IndicF5, or commercial) for any public deployment. |
| Flux-schnell / Flux-dev | Black Forest Labs | Apache-2.0 / Flux-1-dev non-commercial | Not yet enabled; would require GPU. Licence review needed before enabling. |
| SDXL base / refiner | Stability AI | CreativeML OpenRAIL-M | Not yet enabled; OpenRAIL has use restrictions. |
| Wav2Lip / MuseTalk | Research code | Varies (some non-commercial) | Not yet enabled; licence review needed. |
| Piper TTS voices (`ta_IN`) | RHVoice / Piper community | MIT (engine); per-voice CC-BY or CC0 | Candidate replacement for edge-tts; audit each voice licence. |
| faster-whisper / Whisper | OpenAI / Guillaume Cazaud | MIT (code); weights per model card | Candidate for ASR (Caption Video); not yet working on Python 3.14. |

---

## Verification Commands

Run before every release tag:

```bash
# 1. No third-party host references in source (except docs)
git grep -nE "vsub\.io|invideo\.ai|heygen\.com|synthesia\.io|kapwing\.com" -- . \
  ':!docs/02-reverse-engineering.md' ':!docs/11-legal-and-compliance.md'

# 2. No accidentally committed bundle mirrors
git ls-files | grep -E "_next/static|reference-js" && echo "ERROR: mirror committed" || echo "OK"

# 3. All bundled fonts have OFL text present
test -f packages/art/fonts/OFL-NotoSans.txt && \
test -f packages/art/fonts/OFL-NotoSansTamil.txt && \
test -f packages/art/fonts/OFL-NotoEmoji.txt && echo "OFL files present"

# 4. Python deps match requirements.txt
cd services/media && pip list --format=freeze | sort && echo "---" && sort requirements.txt
```

---

## Licence of this Repository

FacelessPro source code is **MIT licensed** (see `LICENSE`).
The bundled fonts remain under **SIL OFL 1.1**.
All third-party notices above are accurate as of the commit that adds this file.