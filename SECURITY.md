# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's [private vulnerability reporting](https://github.com/tokenbot-org/tokenbot-cli/security/advisories/new) on this repository. That opens a draft advisory visible only to you and the maintainers, and it is the preferred channel — it needs no email, and it keeps the report, the fix, and the eventual advisory in one place.

Please include, where you can:

- the version affected (`tokenbot --version`)
- what an attacker can do with it, not just what is wrong
- steps to reproduce, ideally against a throwaway account
- whether local exchange credentials or CLI identity keys are involved

You will get an acknowledgement within a few business days. If a fix ships, you will be credited in the advisory unless you ask otherwise.

## Supported versions

`tokenbot` is pre-1.0 and published under the `beta` dist-tag. Only the latest published version receives fixes. Upgrade with:

```bash
npm install -g tokenbot@latest
```

## What this CLI holds on your machine

Worth knowing when judging the impact of a finding:

- **CLI identity** — a secp256k1 keypair in `~/.tokenbot/config.json`, encrypted with your passphrase (`scrypt` → `HKDF` → `nacl.secretbox`). It authenticates every request you make.
- **Local exchange API keys** — optional, in `~/.tokenbot/keys.json`, encrypted with a key derived from your unlocked identity private key. **These are never transmitted to TokenBot servers.** They are used only by local commands such as `tokenbot balance`.

Anything that could expose either file's plaintext, weaken the derivation, or cause credentials to leave the machine is high severity — say so in your report.

Note that `tokenbot exchange add` is a deliberate exception: it uploads credentials **you supply at that prompt** to the platform so server-side strategies can use them. That path is by design and separate from the local key store.

## Scope

In scope: this repository and the published `tokenbot` npm package.

Out of scope here: the TokenBot platform APIs and services. For those, use the same private reporting channel and say which service you mean — they live in separate, private repositories.

## Supply-chain reporting

If you believe a **published** `tokenbot` tarball was tampered with, include the version and the tarball's `shasum`, and report it privately rather than publicly. Published versions can be verified against the registry:

```bash
npm view tokenbot@<version> dist.integrity
```
