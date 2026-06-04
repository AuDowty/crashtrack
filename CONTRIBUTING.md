# Contributing

PRs welcome. See [SETUP.md](SETUP.md) for local setup.

## Workflow

1. Fork, branch from `main`.
2. `npm install` at the repo root.
3. WASM changes: `cd packages/parser && wasm-pack build --target web --release`.
4. `npm --workspace apps/api run typecheck` and `npm --workspace apps/web run typecheck` should pass.
5. Add a test under `apps/api/test/` if you touch a pure-function module.

## Security

Don't open public issues for vulnerabilities. Email `austindowty@gmail.com`.

## License

MIT — contributions are MIT.
