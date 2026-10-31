# 11 — Legal, licensing, compliance

Not legal advice. This is the checklist I hold myself to, written down so it is decided once
instead of re-litigated at every commit.

---

## 1. What we copy, and what we don't

Copying **behaviour** is normal competition. Copying **expression** is infringement.

| Safe | Unsafe |
|---|---|
| Endpoint names, field names, status values, defaults — a functional interface | Their source code, minified bundles, or server internals |
| Feature list and workflow order | Marketing copy, headlines, FAQ wording |
| Unit-cost *math* as a functional requirement | Their pricing page prose, plan names as brand assets |
| Our own examples and fixtures | Their sample videos, template artwork, creator thumbnails, screenshots |
| The idea "script → scenes → images → captions" | Their logo, wordmark, colour system, illustration style for branding |
| Our own fonts (Noto, OFL) | Their fonts or licensed typefaces |
| Interoperability testing against public docs | Scraping behind auth, or using their API as our backend |

Rules I follow:

1. **No vsub code, ever.** Nothing from the bundle mirror is pasted into this repo. The mirror
   lives outside the repo and is not committed.
2. **No vsub assets.** Every image, font, sample, and screenshot in this repo is generated or
   licensed by us. `packages/art/fonts/*` are Noto (SIL OFL 1.1).
3. **Own copy.** Product text is written from scratch. If a sentence could be confused for
   theirs, rewrite it.
4. **Own visual identity.** Different name, different palette, different type, different
   illustration direction. Similar *capability*, distinct *dress*.
5. **Trademark hygiene.** Never use "vsub" in the product name, domain, or metadata. Use it only
   in factual comparison text ("compatible with the vsub API shape"), if at all.
6. **No implied affiliation.** No "official", no "powered by", no compatibility badge on the
   landing page without a clear disclaimer that this is an independent implementation.

---

## 2. Engine licences (must be verified before launch)

| Component | Licence / status | Action |
|---|---|---|
| **ffmpeg** | LGPL/GPL depending on build | ship an LGPL build (no `--enable-gpl`), or accept GPL for the media container only |
| **Noto Sans / Noto Sans Tamil** | SIL OFL 1.1 | include the OFL text in `THIRD_PARTY_NOTICES.md` |
| **edge-tts** | Python client; talks to Microsoft's consumer Read Aloud endpoint — **not a public API** | ⚠️ **launch blocker.** Personal/dev use only until replaced by a licensed engine for any public deployment |
| **IndicF5 / AI4Bharat models** | check the model card for the exact revision we pin | record revision + licence text; do not assume |
| **Piper** | MIT (engine); per-voice licences vary | audit each `ta_IN` voice |
| **faster-whisper / Whisper weights** | MIT (code), weights licence per model card | fine, keep notice |
| **Cloudflare Workers AI** | governed by Cloudflare's terms | free tier ≠ unlimited commercial use; read before launch |
| **Pollinations.ai** | key/Pollen terms change; legacy keyless output is watermarked | drafts only unless current terms permit production; never strip the provider watermark |
| **SDXL / Flux weights** | Flux-schnell: Apache-2.0; SDXL: CreativeML OpenRAIL | OpenRAIL has use restrictions — read them |
| **Wav2Lip / MuseTalk / SVD** | research licences, some non-commercial | ⚠️ check before enabling lip-sync/avatar publicly |
| **Music / SFX** | must be CC0 or licensed | keep a `data/assets/CREDITS.md` row per file |
| **Emoji** | Noto Color Emoji (OFL) or Twemoji (CC-BY 4.0) | prefer Twemoji for consistency; attribute |

**Deliverable:** `THIRD_PARTY_NOTICES.md` generated from `data/licenses/*.json`, one entry per
dependency with name, version/revision, licence, URL, and where it is used.

---

## 3. Voices and consent

- **Do not clone a voice without documented consent.** Voice import (P10) requires an explicit
  checkbox + a stored attestation row: who, when, what they authorised.
- Never clone a public figure, a YouTuber, a politician, or a customer-support voice for
  comedy/deception.
- Tamil/English preset voices from edge-tts are synthetic presets, not real people — but the
  endpoint's terms still apply.
- Store the voice plan (`voice_plan` jsonb) so any narration is reproducible and auditable.

---

## 4. Content policy for the videos this tool makes

Faceless AI channels live or die on platform policy, so this belongs in the product:

- **YouTube monetisation** requires *original and authentic* content. A video that is a script
  plus generic AI images plus a TTS read is at risk of being classed as mass-produced,
  repetitious content. Our differentiators help here: a cloned channel style, consistent
  characters, real narration, and human editing of the script. The tool should not be marketed
  as "press a button, get money".
- **Disclosure:** several platforms now require labelling synthetic media. The editor gets a
  "mark as AI-generated" export note, and the docs say plainly that the creator is responsible
  for disclosure.
- **No deceptive templates.** "Fake text" videos must not be presented as real conversations
  with real people. The template ships with a visible watermark option and the docs forbid
  using real names/photos of third parties.
- **Copyright:** the tool never ingests third-party video except as a *style reference*, and the
  style pipeline extracts **descriptive features** (palette, medium, composition), not frames.
  Reference videos are deleted after the profile is built (retention 7 days max), and the UI
  says so. This is a meaningful mitigation: we do not store or reproduce the source footage.
- **Music:** only CC0/licensed tracks; per-track credit rows.

---

## 5. Data handling

| Data | Retention | Notes |
|---|---|---|
| Scripts | lifetime of the video | user content; `LOG_SCRIPTS=0` by default |
| Uploaded voiceover | 7 days after processing | then pruned |
| Reference video for style | 7 days (deleted after profile) | stated in the UI |
| Generated frames | 14 days | regenerable |
| Renders | 90 days | stable URL while retained |
| API keys | until revoked | hash only, never recoverable |
| Webhook payloads | 30 days | for replay debugging |

Self-host default: nothing leaves the machine except calls to the engines I explicitly enable.

---

## 6. Pre-launch checklist

- [ ] `THIRD_PARTY_NOTICES.md` complete and accurate.
- [ ] edge-tts replaced (or a licensed engine made primary) for the public deployment.
- [ ] Flux/SDXL/OpenRAIL use restrictions reviewed against the product's use.
- [ ] Voice-import consent flow implemented before the feature ships.
- [ ] Reference-video retention + deletion implemented and stated in the UI.
- [ ] Terms of Service + Privacy Policy + Acceptable Use drafted.
- [ ] No vsub trademark in name, domain, meta tags, or app store listing.
- [ ] No vsub asset anywhere in the repo (grep for their hosts before tagging a release).
- [ ] DMCA/abuse contact published.
- [ ] Synthetic-media disclosure option present in export.

---

## 7. Grep gate for releases

Run before every tag:

```bash
# nothing from their infrastructure should ever be referenced
git grep -nE "vsub\.io|storage\.vsub|cf-content\.vsub|api\.vsub" -- . \
  ':!docs/02-reverse-engineering.md' ':!docs/11-legal-and-compliance.md'

# no accidentally committed mirror
git ls-files | grep -E "_next/static|vsub-js" && echo "ERROR: mirror committed"
```

The reverse-engineering doc is allowed to name the target — it is the record of how this was
built. Everything else must be clean.
