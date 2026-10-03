# Robs AI Cockpit Pro (open core)

Robs AI Cockpit is **open core**:

| | Open source (this repository, Apache-2.0) | Pro (official download) |
|---|---|---|
| Terminals, overview, tasks, review, loops & queues, voice, usage, quota, notifications, … | ✅ | ✅ |
| **Assistants**: characters, soul.md / agent.md, chat room, goals | — (info page) | ✅ |
| **Goals**: supervisor model writes every next prompt | — | ✅ |
| Price | free | free for 7 days, then monthly or yearly |

The official installer on the [Releases page](https://github.com/darkcool70/robs-ai-cockpit/releases)
is the Pro edition. Everything outside Pro keeps working without a license.

## How the Pro edition is built

The Pro code lives in a separate private repository that is checked out at `./pro`
(ignored by this repository's `.gitignore`):

```
pro/
  src/              Pro UI (AssistantsView, ProSettings), imported as "@pro/…"
  src-tauri/        Rust module `pro` (assistants, goal supervisor, license)
  license-server/   Cloudflare Worker: Stripe checkout, webhooks, license tokens
```

* **Frontend:** `vite.config.ts` and `tsconfig.json` resolve `@pro/*` to `pro/src` when it
  exists, else to the stubs in `src/pro-stub`. `__PRO__` tells the code which build it is.
* **Backend:** the Cargo feature `pro` compiles `pro/src-tauri` as `crate::pro` and registers its
  commands; without it, goals pause with a note and assistant commands do not exist.
* **Release:** `.github/workflows/release.yml` checks out the private repository (secret
  `PRO_REPO_TOKEN`) and builds with `--features pro` against the license server in the
  repository variable `ROBS_LICENSE_URL`. It refuses to release without both.

Building from source without `./pro` gives the open-source edition; `pnpm tauri dev` and
`pnpm tauri build` work as before.

## License check

* **Trial:** 7 days from the first start, stored locally.
* **Subscription:** bought on the license server's page (Stripe Checkout). The customer gets a
  license key and pastes it into Settings → Pro.
* **Token:** the app sends the key and a random device id to `ROBS_LICENSE_URL/v1/activate`
  and receives a token signed with Ed25519. It verifies the signature offline with the public
  key built into the app. The token is valid until the end of the paid period plus 3 days.
* **Refresh:** about once a day while online. This picks up renewals and cancellations.
* **Devices:** a key works on 3 computers. Settings → Pro → *Remove from this computer* frees a
  slot.

The license server only stores the key, Stripe customer / subscription ids, the plan, its
status and period end, the buyer's email (from Stripe) and the device ids. Nothing about
projects, prompts or usage is ever sent.
