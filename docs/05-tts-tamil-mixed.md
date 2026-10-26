# 05 — Tamil + English mixed narration (the core differentiator)

> Goal: a sentence like
> `"இன்னைக்கு நாம பாக்கப் போறது, the biggest mistake first-time freelancers make."`
> and a sentence like `"vanakkam machan, epdi irukka? today we talk about money."`
> must both sound like **one person talking naturally**, not two voices alternating.

---

## 1. The four failure modes we are designing against

| # | Failure | What it sounds like |
|---|---|---|
| F1 | One voice for everything | Tamil voice reads "freelancers" as `ப்³ரீலான்ஸர்ஸ்`; or English voice reads Tamil as gibberish |
| F2 | Sentence-level switching | Correct language, wrong prosody: the pitch resets at every clause, seams are audible |
| F3 | Script-blind splitting | `vanakkam machan` is Latin script, gets the English voice, and the Tamil identity of the narration is gone |
| F4 | Naive concatenation | Clipped consonants at joins, ±6 dB loudness jumps, 300 ms dead air, captions drift |

Everything below exists to defeat one of those.

---

## 2. Current state in the repo

| Piece | File | Status |
|---|---|---|
| Script-aware segmenter + Tanglish lexicon (647 unique words) | `packages/core/src/segmenter.ts` + `data/tanglish.json` | ✅ built, 45 tests |
| Lexicon loader, morphology, protected list | `packages/core/src/lexicon.ts` | ✅ built, 21 tests |
| Types (`Lang`, `ScriptKind`, `TextRun`) | `packages/core/src/types.ts` | ✅ |
| edge-tts engine with `WordBoundary` timings | `services/media/app/tts.py` | ✅ built (7.3.1 pinned; 7.2.8 gets HTTP 403) |
| `/synthesize` endpoint, per-run WAV + `master.wav`/`master.mp3` + `timeline.json` | `services/media/app/main.py` | ✅ built, 91 pytest tests |
| Transliteration (Tanglish → Tamil script) | `packages/core/src/transliterate.ts` + `data/tanglish-ta.json` | ✅ built, 68 tests |
| Inline overrides `[[ta:…]]` | `packages/core/src/overrides.ts` | ✅ built, 23 tests |
| Gap calibration + loudness matching + program stage + cross-fade | `services/media/app/{stitch,audio,boundaries}.py` | ✅ built, sample-exact starts, frame-exact master |
| Number/date/unit expansion | `packages/core/src/numbers.ts` | ✅ built, 103 tests |
| Per-run synthesis cache (raw audio + words, pre-trim) | `services/media/app/cache.py` | ✅ built, 13 tests |
| Narration plan (ordering: overrides → numbers → segment → transliterate → voices) | `packages/core/src/plan.ts` | ✅ built, 17 tests |
| Golden audio + listening suite | `scripts/sample-tts.ts` | ✅ 6 clips generated, listening gate pending |
| Tamil voice catalogue + capability tags | `services/media/app/voices.py` | ✅ built, 22 tests + live ids |

The prototype already does the hard structural thing right: it returns **runs** (not
sentences), so the same sentence can switch voice mid-clause. P1 turns the prototype into
something that sounds good.

---

## 3. Design

### 3.1 Three-stage plan

```
text
 │
 ├─ 1. NORMALISE          numbers, dates, units, abbreviations, emoji → spoken form
 │                        (language-aware: "2024" → Tamil words in a Tamil clause,
 │                         "twenty twenty-four" in an English clause)
 │
 ├─ 2. LABEL              per word: ta | en | tanglish   (script + lexicon + morphology)
 │                        → group adjacent words into runs
 │
 └─ 3. ROUTE              ta        → Tamil voice
                           en        → English voice
                           tanglish  → transliterate → Tamil voice
```

Then synthesis, then stitching. Each stage is a pure function in `packages/core`
(stages 1–2) and a port call (stage 3), so all of it is unit-testable without audio.

### 3.2 Labelling rules (extends the existing segmenter)

Current behaviour (keep):
- any Tamil codepoint (U+0B80–U+0BFF) → `ta`;
- Latin word in `DEFAULT_TANGLISH` → `tanglish`;
- otherwise `en`;
- consecutive same-language words merge into one run; last word keeps its punctuation/spacing.

Additions for P1:

1. **External lexicon file** `packages/core/data/tanglish.json` — user-editable, versioned,
   merged over the built-in set. This is the "update-able" part: new slang gets added without
   a code change.
2. **Morphological heuristic** (guarded): a Latin token is `tanglish` if it matches a Tamil
   suffix pattern **and** its stem is in the lexicon:
   ```
   /(ku|kku|la|le|laam|nga|ngaḷ|thu|dhu|pannu|panra|panren|irukku|aaga|oda|kooda)$/
   ```
   e.g. `veetukku` → stem `veetu` known → tanglish. `stuffku` → stem unknown → stays English.
   This catches inflection without misclassifying English.
3. **Protected-English list** — words that look Tamil-ish but are English in this context
   (`van`, `man`, `an`, `anna` is ambiguous...). Keep the existing exclusion philosophy:
   when in doubt, choose `en`. Misrouting English to a Tamil voice is worse than the reverse.
4. **Explicit overrides** — inline markup for debugging/editor use:
   `[[ta:…]]`, `[[en:…]]`, `[[tl:…]]` force a language for that span. Stripped before
   synthesis. The editor's voice-plan inspector writes these.

   Implemented in `packages/core/src/overrides.ts` (`parseOverrides` →
   `segmentText({ overrides })`, or the one-call `segmentWithOverrides`). The
   contract:

   | Case | Behaviour |
   |---|---|
   | `[[ta:…]]` | Tamil voice. Script is `tamil` if the span contains Tamil letters, else `tanglish`. |
   | `[[en:…]]` | English voice, script `latin`. |
   | `[[tl:…]]` | Alias for `ta` (Tanglish is Tamil speech). |
   | Kind case | Case-insensitive (`[[TA:…]]` works). |
   | Forced word next to a run of the same language | Merged — overrides never fragment the track needlessly. |
   | Span covering only part of a word | Ignored; half a word cannot be half a voice. |
   | Unclosed `[[ta:…`, empty `[[ta:]]`, unknown kind `[[xx:…]]`, content containing `[[` | Left in the text **verbatim**. A half-typed marker never deletes the author's words. |

   `parseOverrides` returns spans in *marker-stripped* coordinates, so the editor can map a
   run back to a character range in the cleaned script.

### 3.3 Transliteration (Tanglish → Tamil script)

Why: the Tamil voice needs Tamil orthography. Feeding `vanakkam` to `ta-IN-*` yields an
English-accented reading.

**Design finding that changed this section.** The original spec here described a pure rule
engine. That is not achievable to a usable standard, because Tanglish is not a consistent
romanisation — the *same letters* spell different Tamil:

| Letters | Word | Tamil | Needs |
|---|---|---|---|
| `o` | `sollu` | சொல்லு | `ொ` (short) |
| `o` | `podu` | போடு | `ோ` (long) |
| `nn` | `pannu` | பண்ணு | `ண்ண` (retroflex) |
| `nn` | `enna` | என்ன | `ன்ன` (alveolar) |
| `ll` | `sollu` | சொல்லு | `ல்ல` |
| `ll` | `thallu` | தள்ளு | `ள்ள` |
| `n` | `avan` | அவன் | `ன்` (final) |
| `n` | `vanakkam` | வணக்கம் | `ண` (before `க்க`) |

So the implementation is **dictionary first, rules second**:

```
word ──► normalise ──► dictionary hit? ──yes──► Tamil script
                              │
                              no
                              ▼
                       rule engine (best effort)
```

1. **`data/tanglish-ta.json`** — the source of truth. 400+ pinned high-frequency words,
   versioned, user-editable. Adding a word is one line of data, never a code change.
2. **`transliterate.ts` rule engine** — a state machine over a grapheme table, for the long
   tail (names, slang, new words) so nothing is ever left unreadable.

Rule engine behaviour:

- a consonant is held until a vowel attaches to it; a second consonant flushes the first as a
  coda with virama (`kk` → `க்க`);
- a coda nasal takes the homorganic form its follower demands (`m`+`b` → `ம்ப`, `n`+`g` →
  `ங்க`, `n`+`j` → `ஞ்ச`, `n`+`t` → `ண்ட`);
- geminate `nn` → `ண்ண`, `rr` → `ற்ற`;
- word-final `n` → `ன்` (`magan` → மகன்);
- longest-match-first over `zh th dh sh ch nh kh gh bh ph lh rh` and
  `aa ee ii oo uu ai au`;
- `s` → ச (Tanglish `s` is overwhelmingly ச: `sollu`, `sari`, `kaasu`), `sh` → ஷ;
- anything unmatched is copied through unchanged.

**What is *not* transliterated.** Only runs the segmenter labelled `tanglish` are rewritten.
English stays English (`today we talk about money`), native Tamil stays native. This matters:
`transliterateText()` rewrites every Latin word and is therefore a raw utility; the pipeline
calls `transliterateTanglish()`, which segments first. A test asserts that the raw form does
mangle English, so the footgun stays documented rather than forgotten.

**Quality bar and how it grows.** The bar is "a Tamil speaker understands it and it does not
sound foreign", not textbook orthography. `npm run tts:audit` lists every routed word that is
still rule-only, with its current output, so a wrong one is fixed by adding a dictionary row.
At the time of writing, 428 of 647 routed words are pinned (442 dictionary entries).

**Honesty note.** The dictionary forms and the golden table were authored during
implementation. Structural properties are tested (Tamil script only, no doubled virama, keys
normalised, 30 exact pairs asserted). Whether each form *sounds* right is a human judgement and
belongs to the P1 listening gate — no test can assert it.

### 3.4 Stitching (F4)

Implemented in `services/media/app/stitch.py` + `app/audio.py`; gaps in
`app/boundaries.py`. All boundaries are millisecond-quantised, so the timeline and the
audio are built from the same frame counters and cannot drift.

Per run, after synthesis:

1. **Trim** leading/trailing silence at −45 dB, keeping 20 ms of headroom. The removed
   head is remembered (`head_trim_ms`) and subtracted from every word boundary.
2. **Loudness-match** each run to −16 LUFS integrated, true peak ≤ −1.5 dBTP
   (`ffmpeg loudnorm` two-pass per run, measured on the *trimmed* run, applied linearly, so
   the sample count never changes and silence cannot drag the gain). Fully silent audio
   skips normalisation instead of producing `-inf`.
   Per-run matching is **peak-bound**: edge-tts output already sits near full scale, so a
   short run cannot reach −16 LUFS without breaking the true-peak ceiling. Measured on the
   listening-gate clips, every run landed at exactly −1.50 dBTP and the 1.6 s runs came out
   at −18.9 LUFS. That is why step 5 exists.
3. **Gap** between runs, decided by the *text between them*:

   | Boundary | Gap used |
   |---|---|
   | no punctuation (language switch), or same run | 0 ms + 5 ms fade |
   | comma `,` `，` `、` | 110 ms |
   | clause `;` `:` `—` `–` | 180 ms |
   | sentence `.` `?` `!` `।` `…` | 300 ms |
   | paragraph (any newline) | 475 ms |

   These are the midpoints of the documented ranges, deterministic on purpose. A language
   switch without punctuation gets **no** pause: one bilingual speaker does not stop
   mid-sentence to change language. `gap_ms` in the request overrides every boundary.
   `gap_ms_for(boundary, speed=…)` already scales by delivery speed; the request does not
   expose `speed` yet (it arrives with `voiceStyle` at P4).
4. **Concat** with a 5 ms equal-power fade at each run edge. The fade sits inside the pause,
   so it kills the cut click without smearing consonants. A test measures the sample delta at
   the join (≤ 200 in 16-bit terms); without the fade a 320 Hz tone jumps by thousands.
5. **Program loudness** (`master_program`) on the assembled `master.wav`. Measure integrated
   loudness and true peak, apply the difference to −16 LUFS as a plain `volume` gain. When
   that gain would push peaks past −1.5 dBTP, a true-peak limiter runs first
   (`alimiter=limit=0.8337:attack=5:release=50:level=false:latency=true` — `latency=true`
   compensates the 5 ms lookahead, so the frame count and every sample position are
   unchanged; without it the audio shifts 239 samples). The result is measured again and a
   final plain gain closes any inter-sample overshoot the sample-domain limiter cannot see.
   The stage refuses to write a file whose frame count moved.
6. **Timeline** — every run carries `start_ms`, so word timings stay exact after stitching:
   `global = run.start_ms + word.local_ms`, clamped inside the run. This is the single most
   important invariant for captions. `timeline.json` records the master stage
   (`gain_db`, `limited`, `input_lufs`, `input_dbtp`) for auditing.
7. **Output** — `master.wav` (48 kHz mono PCM, the source of truth for duration) plus
   `master.mp3` (192 kbps, for listening), per-run WAVs, and `timeline.json` with runs, gaps,
   boundary classes and global words.

Observed on the six listening-gate clips (edge-tts, `pallavi-neerja`, 2026-10-26): master
−16.28…−16.46 LUFS integrated (0.18 LU spread), true peak −1.79…−1.86 dBTP, program gains
+0.08…+1.36 dB, and every `master.wav` frame count exactly `total_duration_ms × 48`.
Before the program stage the same clips spread −16.35…−17.62 LUFS.

### 3.5 Voice pairing

A "pair" is `{ taVoice, enVoice }` chosen to sound like the same person:

| Pair | ta | en | Notes |
|---|---|---|---|
| `pallavi-neerja` | `ta-IN-PallaviNeural` | `en-IN-NeerjaNeural` | default for narration |
| `valluvar-prabhat` | `ta-IN-ValluvarNeural` | `en-IN-PrabhatNeural` | male, explainer |
| `indicf5-ta` | IndicF5 (ta) | same model, en prompt | one model, best timbre continuity, slower |
| `piper-offline` | Piper ta | Piper en | zero network, lowest quality |

Pair selection is explicit (`voiceId` can be a pair id) **or** explicit per language
(`voiceId: { ta, en }`). We never let gender/accent mismatch happen silently.

Implemented in `services/media/app/voices.py` (9 voices, 4 pairs, `resolve_pair()` /
`voice_for_lang()`), because voice ids are engine knowledge, not pipeline logic:

- A pair is validated on load: Tamil voice really speaks `ta`, English voice really speaks `en`,
  both come from the same engine and have the same gender and word-timing capability. A
  hand-built `{ ta: Pallavi, en: Prabhat }` is rejected, not quietly degraded.
- A bare engine voice id is **not** accepted as a `voiceId`: one edge voice cannot serve both
  languages, so accepting it would hide the second-language choice.
- `ta-LK-SaranyaNeural` and `ta-LK-KumarNeural` are catalogued but deliberately unpaired — a Sri
  Lankan Tamil accent under an Indian English sentence is exactly the mismatch this table exists
  to prevent. Add a `ta-LK + en-LK` pair only when an `en-LK` voice ships.
- Ids are pinned and snapshotted in `test_voices.py`. `test_live_voices.py` (`RUN_LIVE=1`)
  re-checks them against `edge-tts --list-voices`, because Microsoft adds and removes voices
  without notice; a vanished voice must fail the build, not a render.
- Verified live on 2026-10-26: the four `ta-IN`/`ta-LK` voices and both `en-IN` voices above
  exist, plus `en-IN-NeerjaExpressiveNeural` (catalogued later if we want a warmer default).

> Test transport note: starlette ≥ 1 renamed the TestClient dependency to `httpx2`.
> `requirements-dev.txt` pins `httpx2`, not the old `httpx`; on Python 3.14 the old pin makes
> every FastAPI test fail at collection.

### 3.6 Numbers, dates, units

Language-aware expansion before labelling (`packages/core/src/numbers.ts`):

| Input | Tamil clause | English clause |
|---|---|---|
| `2024` | இரண்டாயிரத்து இருபத்துநான்கு | twenty twenty-four |
| `1947` | ஆயிரத்து தொள்ளாயிரத்து நாற்பத்தேழு | nineteen forty-seven |
| `₹500` | ஐந்நூறு ரூபாய் | five hundred rupees |
| `1,20,000` | ஒரு லட்சத்து இருபதாயிரம் | one lakh twenty thousand |
| `3pm` | மூன்று மணி | three p m |
| `50%` | ஐம்பது சதவீதம் | fifty percent |
| `2.5` | இரண்டு புள்ளி ஐந்து | two point five |

Conventions, all locked by `numbers.test.ts`:

- Tamil compounds are written joined (`இருபத்துநான்கு`); a linker suffix is applied where the
  language requires one (`ஆயிரம்` → `ஆயிரத்து`, `ஒரு லட்சம்` → `ஒரு லட்சத்து`).
- Irregular thousands are spelled, not derived: `மூவாயிரம்`, `நாலாயிரம்`, `ஐயாயிரம்`.
- English uses Indian grouping (lakh, crore), because the audience is Indian.
- A bare 4-digit value in 1100–2099 is read as a year; `{ year: false }` turns that off, and
  decimals/currency/percent/time never use the year reading. Tamil always reads the full number.
- Fractional digits are read one at a time; currency and percent append a word, never a symbol.
- The language of a number is the **majority language of its clause**, not the word in front of it,
  so one English loanword (`எங்கள் business ₹1,20,000 லாபம்`) cannot flip a Tamil number into
  English. Ties fall back to the nearest preceding word, then the nearest following word, then
  `defaultLang` (`expandNumbersContextual()`). One string can therefore mix both languages.

Known limits (deliberate, and scheduled rather than half-fixed):

- A Tamil case suffix glued to a number keeps its written separator: `2024-ல்` becomes
  `இரண்டாயிரத்து இருபத்துநான்கு-ல்`, and `50%க்கு` becomes `ஐம்பது சதவீதம்க்கு`. Correct would be
  `…நான்கில்` / `…சதவீதத்திற்கு`, which needs a sandhi layer with its own listening test. Until then
  prefer `2024 ஆம் ஆண்டில்` in authored scripts. Tracked in [09](./09-roadmap.md) P1.

### 3.7 Synthesis cache

`services/media/app/cache.py`. Key: `sha256` of canonical JSON
`{v, engine, voice, text}` — the **text actually sent to the engine**, after transliteration and
number expansion.

Why that exact set:

- `voice` and `engine` change the audio, so they must be in the key.
- `text` is enough to capture every upstream transform. A lexicon fix changes the transliterated
  text and therefore the key. If a fix leaves the text identical, the audio really is identical and
  the hit is correct — no lexicon-version counter is needed, and none is invented.
- `v` (`CACHE_FORMAT`) is the escape hatch for a change to the stored payload shape.

Stored: raw provider audio + word timings + `duration_ms`, **before** trimming. So stitch settings,
gap calibration and the master stage can change without invalidating a single entry.

Each entry is `<key>.audio` + `<key>.json`. The audio is written first, the JSON last, each through
a unique temp file and an atomic rename: a crash mid-write leaves a pair the reader ignores rather
than a half-entry that would poison every later retry. A JSON that cannot be parsed, or that
describes words the model rejects, is deleted and treated as a miss — a cache must never break
playback. A full or read-only disk also cannot fail the request: `put()` errors are swallowed and the
fresh audio is still returned.

Bounded by `TTS_CACHE_MAX_MB` (default 2048), pruned oldest-first when a write takes it over budget.
`TTS_CACHE=0` disables it; `GET /cache` reports hits/misses/entries/bytes.

Observed (real edge-tts, `ta-IN-PallaviNeural`, one 46-character run): cold 2.15 s, warm 0.48 s —
the remaining time is ffmpeg trim/stitch/master, not the network. Same duration (2966 ms) and the
same word list on both paths.
- Identifiers are never rewritten: `mp3`, `h264`, `v2`, `5G`, `abc123`, `2nd` pass through untouched.

This matters more than it sounds: faceless videos are full of numbers, and a Tamil voice
reading `2024` as "two zero two four" is instantly wrong.

---

## 4. Engines

| Engine | Tamil? | Mixed handling | Word timings | Cost | Use |
|---|---|---|---|---|---|
| **edge-tts** (default) | ✅ `ta-IN-*`, `ta-LK-*` | good with our routing | ✅ `WordBoundary` | free, no key | default |
| **AI4Bharat IndicF5** | ✅ (Indic-strong) | needs per-run prompting | ❌ (align after) | free, local GPU/CPU | quality upgrade, Tamil-first |
| **Piper** | ✅ (`ta_IN` voices exist) | weak on English | ❌ | free, offline | no-network fallback |
| **Azure Speech** | ✅ | native bilingual | ✅ | paid | prod-grade option |
| **ElevenLabs** | ✅ multilingual v2 | strong | ✅ | paid | parity voice provider |
| **Google Chirp3 HD** | ✅ | native | ✅ | paid | alt |

All behind `TTSPort`, selected by `TTS=edge,indicf5,piper`.

### ⚠️ Engine licensing / ToS risk (must resolve before public launch)

- **edge-tts** talks to Microsoft's consumer Edge "read aloud" endpoint. It is **not a public
  API**, has no SLA, and using it for a commercial product is a **licence/ToS risk**. Fine for
  personal use and development. **Launch blocker to resolve** — see
  [11-legal-and-compliance.md](./11-legal-and-compliance.md).
- IndicF5 / Piper weights: check each model card's licence before shipping; keep the licence
  text in `THIRD_PARTY_NOTICES.md`.
- Any *cloned* voice needs documented speaker consent. Non-negotiable.

---

## 5. Tests (this is the part that must not be skipped)

### 5.1 Pure unit tests — no network, run on every commit

```
segmenter.test.ts        existing 196 lines, extended:
  • Tamil script → ta
  • Tanglish lexicon → tanglish
  • mixed sentence → run boundaries at the right places
  • punctuation/whitespace preservation
  • "no two consecutive runs share a lang"
  • inflection heuristic: veetukku=tl, stuffku=en
  • overrides: [[en:…]] wins

transliterate.test.ts
  • 300-pair golden table
  • idempotence for residuals: unmatched latin passes through unchanged
  • never throws on emoji, digits, combining marks, lone surrogates

numbers.test.ts
  • ta vs en expansion of 2024 / ₹500 / 3pm / 50% / 1,20,000

stitch.test.ts            (pure timeline math)
  • gaps per boundary class
  • global word timing offset correctness (property test, 10k random plans)
  • monotonic, non-overlapping, last word end ≤ total
```

### 5.2 Contract tests — media service, engine faked

```
test_synthesize.py        existing; extend:
  • run plan → one output file per run, ordered
  • timeline offsets equal Σ(durations + gaps)
  • 502 when the engine yields no audio; 400 on bad voice id
  • idempotent request id → no duplicate files
```

### 5.3 Live tests — opt-in (`LIVE=1`), network, slow

```
test_live_tts.py
  • Tamil-only clip: audio exists, duration plausible, word count == input word count ±10%
  • English-only clip: same
  • MIXED: "இன்னைக்கு நாம் பேசுவோம் about money and freelancing" →
      ≥2 runs, ≥1 ta and ≥1 en route, single output file,
      no gap > 600 ms, integrated loudness −16 ±1 LU, true peak ≤ −1.5 dBTP
  • Tanglish: "vanakkam machan epdi irukka" → routed to Tamil voice,
      transliterated text ≠ input text, output duration 1.5–6 s
  • 60 s Tanglish paragraph: completes < 120 s, no crash, captions words == spoken words
```

### 5.4 Listening gate — human, required before phase close

`npm run sample:tts` writes six clips to `samples/tts/`:

```
01-tamil-pure.mp3      04-mixed-one-sentence.mp3
02-english-pure.mp3    05-tanglish.mp3
03-mixed-paragraph.mp3 06-numbers-dates.mp3
```

I listen to all six. Phase P1 is **not done** until each one passes: "does it sound like one
person, in the right language, without a seam?" That is the acceptance test that no assertion
can replace — but the assertions above make sure we get there without manual rework every time.

### 5.5 Regression protection

- Golden audio **digests** are stored for the 6 sample scripts. A digest change means "the
  voice or the pipeline changed" and requires re-listening. Not a hard failure — a forcing
  function.
- Duration/energy invariants **are** hard failures.

---

## 6. API surface (internal)

`POST /synthesize` on `services/media` (already exists, extend):

```jsonc
{
  "segments": [
    { "text": "இன்னைக்கு நாம் பேசுவோம்", "voice": "ta-IN-PallaviNeural" },
    { "text": " about money and freelancing", "voice": "en-IN-NeerjaNeural" }
  ],
  // optional: force one gap for every join; omit to use the punctuation table
  "gap_ms": 150
}
```

Response (also written to `timeline.json` in the request directory):

```jsonc
{
  "request_id": "…",
  "master_path": "…/master.wav",
  "total_duration_ms": 16280,
  "segments": [
    {
      "index": 0, "voice": "ta-IN-PallaviNeural", "text": "…",
      "audio_path": "…/run-0.wav",
      "start_ms": 0, "duration_ms": 3349, "head_trim_ms": 183,
      "words": [{ "text": "இன்று", "start_ms": 0, "end_ms": 220 }]
    }
  ]
}
```

`start_ms` and `words` are the caption contract: a word's global start is always
`segment.start_ms + its local start`. `master.mp3` sits next to `master.wav` for listening.

Public API parity (`/v1/text-to-speech`) stays vsub-shaped: `{text, voiceId, voiceStyle}` →
`{id, url, characters, expiresAt}`. The mixed machinery is automatic:

- `voiceId: "ta-IN-PallaviNeural"` + Tamil/English text → auto-routed to a compatible pair.
- `voiceId: { "ta": "…", "en": "…" }` (our extension) → explicit pair.
- `language: "auto"` (our extension) → detect and mix.

---

## 7. Roadmap for this subsystem

| Step | Deliverable | Gate |
|---|---|---|
| 7.1 | lexicon file + loader + morphology heuristic | ✅ unit tests green (47 total) |
| 7.2 | transliteration table + dictionary + rules | ✅ 428 pinned pairs, 68 tests |
| 7.3 | number/date/unit expansion (ta/en) | ✅ 103 tests |
| 7.4 | gap calibration + loudness match + cross-fade + program stage | ✅ stitch/audio tests; 6 gate clips at −16.28…−16.46 LUFS, TP ≤ −1.79 dBTP, frame-exact |
| 7.5 | voice catalogue + pairing + capability tags | ✅ 9 voices, 4 pairs, live-id test |
| 7.6 | IndicF5 adapter | A/B vs edge on the 6 samples |
| 7.7 | forced alignment fallback (ASR) for engines without timings | timing accuracy ≤ 40 ms |
| 7.8 | listening gate | **I approve all 6 clips** |

Only after 7.8 do we touch pictures.
