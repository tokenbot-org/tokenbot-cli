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

tokenbot portfolio                             Server-side holdings, as last synced
tokenbot portfolio --exchange <name>           Filter to one exchange
tokenbot portfolio --asset <code>              Filter to one asset
tokenbot portfolio --all                       Include zero balances

tokenbot link --strategy <s> --copier <c>      Bind a copier to a strategy
tokenbot unlink --strategy <s> --copier <c>    Detach a copier
tokenbot links list                            View every link

tokenbot strategy list|show|add|delete         Manage strategies
tokenbot copier   list|show|add|delete         Manage copiers
tokenbot exchange list|add|supported           Manage server-side exchange links
tokenbot webhooks list|add|remove|test         Manage outbound webhooks
tokenbot rewards  show|refer                   Rewards + referral code
tokenbot apikey   list|create|revoke           Server-side API keys

tokenbot trades                                Trades executed on your account
```

### `tokenbot trades`

Shows what your strategies and copiers have actually done — most recently
executed first.

```
tokenbot trades                                Most recent 25 trades
tokenbot trades --strategy <id>                Only one strategy's trades
tokenbot trades --symbol BTC/USDT              Only one pair
tokenbot trades --status filled                new | filled | canceled | rejected | expired
tokenbot trades --side buy                     buy | sell
tokenbot trades --range week                   today | week | month | quarter | year | all
tokenbot trades --since 2026-07-01 --until 2026-07-15
tokenbot trades --limit 100 --page 2           Page through longer histories
tokenbot trades --json | jq '.[] | .pnl'       Machine-readable output
```

| flag | default | notes |
| ---- | ------- | ----- |
| `--range` | `all` | The API itself defaults to the last month; the CLI asks for the full history so a bot that last traded weeks ago still shows up. Narrow it when you want less. |
| `--limit` | `25` | Capped server-side at 1000. |
| `--symbol` | — | Case-insensitive substring, so `--symbol btc` matches `BTC/USDT` and `BTC/USDC`. Applied client-side over the fetched page. |

Timestamps are UTC, matching exchange records and server logs rather than
your local timezone. `--json` emits the full untruncated ids.

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

## `balance` vs `portfolio`

These read from different places and will show different numbers. That is expected, not a bug.

|             | `tokenbot balance`                            | `tokenbot portfolio`                              |
| ----------- | --------------------------------------------- | ------------------------------------------------- |
| Source      | `~/.tokenbot/keys.json` + ccxt, in-process     | graphql-api, server-side                          |
| Freshness   | live, at the moment you run it                 | as of each account's last sync                    |
| Covers      | credentials stored on **this machine**         | accounts registered via `tokenbot exchange add`   |
| Keys sent   | never                                          | n/a — the server uses its own copy                |

Because the two commands read two independent credential stores, you can legitimately have entries in one and not the other, and see completely disjoint output.

Every `portfolio` row carries its own `synced` column — that timestamp is the explanation for any divergence from `balance`. Quantities are in each asset's own units; the platform computes no fiat valuation, so `portfolio` shows no total.
