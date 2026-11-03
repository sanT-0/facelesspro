# Bundled caption fonts

These files are the fonts used by the ASS/ffmpeg caption renderer. They are
committed so Tamil shaping does not depend on fonts installed on the host.

| Local file | Upstream file | SHA-256 |
|---|---|---|
| `ttf/NotoSansTamil-Variable.ttf` | `ofl/notosanstamil/NotoSansTamil[wdth,wght].ttf` | `aa3a9b321f4b0bb2c40203ffbde9af89713227866e0e13f76e5b9eeea727cf88` |
| `ttf/NotoSans-Variable.ttf` | `ofl/notosans/NotoSans[wdth,wght].ttf` | `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d` |
| `ttf/NotoEmoji-Variable.ttf` | `ofl/notoemoji/NotoEmoji[wght].ttf` | `de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551` |

- Source: <https://github.com/google/fonts>
- Pinned revision: `6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec`
- Licence: SIL Open Font License 1.1 — see the original upstream notices
  [`OFL-NotoSans.txt`](./OFL-NotoSans.txt),
  [`OFL-NotoSansTamil.txt`](./OFL-NotoSansTamil.txt) and
  [`OFL-NotoEmoji.txt`](./OFL-NotoEmoji.txt), plus the repository-level
  [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md).

The files are upstream variable fonts (weight and width axes), renamed locally
to avoid brackets and commas in ffmpeg/fontconfig paths. Their internal family
names remain `Noto Sans Tamil`, `Noto Sans` and `Noto Emoji`. Only font
binaries live under `ttf/`, so ffmpeg's `fontsdir` does not try to parse this
README or the licences as fonts.
