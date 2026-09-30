# Contributing

Thanks for your interest in improving Robs AI Cockpit!

## Reporting bugs and requesting features

* Search the [existing issues](https://github.com/darkcool70/robs-ai-cockpit/issues) first.
* Use the issue templates. For bugs, include your Windows version, the cockpit version and the
  versions of `claude` / `codex` (`claude --version`, `codex --version`).
* Please remove personal data (paths, account names, prompts) from logs and screenshots.
* Security problems: see [SECURITY.md](SECURITY.md) — never in a public issue.

## Development setup

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for prerequisites. In short:

```bash
pnpm install
pnpm tauri dev
```

Use `AI_COCKPIT_HOME=<some temp dir>` while testing so your real `~/.ai-cockpit` stays untouched.

## Before you open a pull request

```bash
pnpm exec tsc --noEmit        # type check
pnpm test                     # frontend unit tests
cd src-tauri && cargo test    # backend tests
```

* Keep pull requests focused: one change per PR.
* Add or update tests for behaviour changes (see *Test coverage* in DEVELOPMENT.md).
* Follow the rules in DEVELOPMENT.md (append-only migrations, no locks across emits, no
  credential-file access, …).
* Update the README / docs and `CHANGELOG.md` (section *Unreleased*) when user-facing behaviour
  changes.

## License of contributions

By submitting a contribution you agree that it is licensed under the
[Apache License 2.0](LICENSE), like the rest of the project (see section 5 of the license).
