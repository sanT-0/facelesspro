# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:

**Security → Advisories → [Report a vulnerability](https://github.com/sanT-0/facelesspro/security/advisories/new)**

That opens a private advisory visible only to you and the maintainer. If GitHub's flow is not
available to you, email **santhoshsankar599@gmail.com** with the subject `facelesspro security`.

Please include:

- what you can do that you should not be able to do, and why it matters;
- the affected revision (`git rev-parse --short HEAD`) and component;
- the smallest reproduction you have — a request, a payload, a file;
- whether you want public credit in the advisory.

We aim to acknowledge within 7 days and to ship a fix or a mitigation plan within 30 days for
anything that touches secrets, authentication, storage or the renderer. No bug bounty is offered.

## Supported versions

Only the tip of `development` is supported. There are no release branches yet.

## In scope

- API keys and workspace isolation (`vp_` keys, `withWorkspace()`).
- Storage key handling — path traversal, absolute paths, symlinks under `DATA_DIR`.
- Upload validation and size/type limits (`POST /v1/art-styles`, `/v1/files`, voiceover intake).
- SSRF in `webhookUrl` handling and in any provider URL built from user input.
- Secret leakage: `.env`, logs, error envelopes, rendered debug output.
- Command injection into ffmpeg/ffprobe argument lists.
- Dependency vulnerabilities that are reachable from the request path.

## Out of scope

- Anything that needs a provider account you control (Cloudflare neurons, Pollinations Pollen).
- Rate limiting and DoS on a self-hosted instance you run yourself.
- The known engine-policy issue in [docs/11 §2](../docs/11-legal-and-compliance.md): `edge-tts`
  uses a non-public consumer endpoint. That is a documented launch blocker, not a vulnerability.
- Vulnerabilities in a fork or in a modified deployment.

## Safe harbour

Good-faith research that follows this policy will not be pursued or reported. Do not access other
people's data, do not run destructive tests against infrastructure you do not own, and give us a
reasonable window before public disclosure.
