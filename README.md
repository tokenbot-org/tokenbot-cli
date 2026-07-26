# tokenbot

The TokenBot user-facing CLI — manage strategies, copiers, exchange links, balances, and webhooks from your terminal.

```
npm install -g tokenbot
tokenbot init
tokenbot whoami
```

## Commands

```
tokenbot init                                  Register a CLI identity
tokenbot whoami                                Show local + server account info
tokenbot login                                 Confirm identity is configured
tokenbot logout                                Delete local config + key store

tokenbot keys add --strategy <id>              Store local exchange credential
tokenbot keys add --copier <id>                Same, bound to a copier
tokenbot keys list                             List stored credential labels
tokenbot keys remove <label>                   Delete a stored credential

tokenbot balance --strategy <id>               Fetch balance via ccxt (local)
tokenbot balance --copier <id>                 Same, by copier
tokenbot balance --all                         Iterate every stored credential

tokenbot link --strategy <s> --copier <c>      Bind a copier to a strategy
tokenbot unlink --strategy <s> --copier <c>    Detach a copier
tokenbot links list                            View every link

tokenbot strategy list|show|add|delete         Manage strategies
tokenbot copier   list|show|add|delete         Manage copiers
tokenbot exchange list|add|supported           Manage server-side exchange links
tokenbot webhooks list|add|remove|test         Manage outbound webhooks
tokenbot rewards  show|refer                   Rewards + referral code
tokenbot apikey   list|create|revoke           Server-side API keys
```

> `keys add` stores exchange credentials locally only; `exchange add` sends them to the
> server so the automated strategies and copiers can trade. See
> [Where exchange credentials go](#where-exchange-credentials-go).

## Global flags

- `--json` — emit raw JSON instead of pretty tables (for piping into `jq`).
- `--config <path>` — point `~/.tokenbot` somewhere else (useful for testing or multi-account setups).

## Exit codes

| code | meaning                          |
| ---- | -------------------------------- |
| 0    | success                          |
| 1    | user error (bad input, no config)|
| 2    | network / server error           |
| 3    | auth error — run `tokenbot init` |

## Where things live

- `~/.tokenbot/config.json` — registered CLI identity (encrypted private key + API URLs)
- `~/.tokenbot/keys.json` — local-only encrypted exchange credentials

Both files are written with mode `0600`. Your CLI identity private key never leaves your machine.

## Where exchange credentials go

The CLI has two independent credential paths. They are not mirrors of each other — which one you use decides whether TokenBot ever holds your exchange keys.

| Command                 | Stored where                            | Sent to the server?                                | Used by                                                            |
| ----------------------- | --------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| `tokenbot keys add`     | `~/.tokenbot/keys.json` on your machine | **No** — never transmitted                          | Local commands like `tokenbot balance`, which call ccxt in-process |
| `tokenbot exchange add` | Server-side `ExchangeAccount` store     | **Yes** — API key, secret, and optional passphrase   | Server-side strategies and copiers that trade on your behalf       |

**`tokenbot keys add` (local-only).** Credentials are encrypted with a key derived from your unlocked CLI identity and written to `~/.tokenbot/keys.json`. The server never sees them; `tokenbot balance` decrypts them in-process and talks to the exchange directly via ccxt.

**`tokenbot exchange add` (sent to the server, deliberately).** This command prompts for your exchange API key, secret, and optional passphrase and uploads them to TokenBot, where they are stored encrypted at rest. This is required by design: the automated strategies and copiers run server-side on a schedule, so they cannot place orders for you unless the platform holds credentials it can reach. Registering an exchange account is also what lets strategies and copiers reference an exchange connection in the API.

If you would rather TokenBot never hold your exchange credentials, stick to `tokenbot keys add` and skip `tokenbot exchange add` — you keep local balance checks, but not server-side automated trading.

Either way, issue **trade-only** API keys with withdrawals disabled.
