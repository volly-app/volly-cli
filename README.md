# volly-cli

Deploy and manage [Volly](https://volly.so) apps from the terminal.

```console
$ volly login                 # browser sign-in (OAuth)
$ volly deploy ./dist         # zip, upload, and publish
Deployed my-app: https://acme-my-app.volly.so
```

## Install

```sh
npm install -g @volly-app/cli      # or: pnpm add -g @volly-app/cli
npx @volly-app/cli deploy ./dist   # or run it without installing
```

Requires Node.js 20+.

## Commands

```text
volly login [--with-token] [--no-browser]   Sign in (browser OAuth, or paste a token)
volly logout | whoami
volly deploy [path] [--app SLUG] [--draft] [-m MSG] [--create] [--yes] [--no-wait]
volly app    list | create SLUG | get SLUG | delete SLUG
volly draft  publish | discard       [--app SLUG]
volly deployments list               [--app SLUG] [--limit N]
volly token  create --name NAME | list | revoke ID
```

Every command takes `--json` (print the raw API response) and `--api-url`
(default `https://app.volly.so`, env `VOLLY_API_URL`).

## Deploying

`volly deploy` accepts a directory (an `index.html` is required at its root;
it's zipped automatically, skipping dotfiles, `node_modules`, and
`volly.json`) or a single `.html`, `.zip`, `.jsx`, or `.tsx` file.

The target app resolves from `--app`, or from a `volly.json` next to your
files:

```json
{ "app": "my-app" }
```

The file is written for you the first time you deploy with `--create`.

Use `--draft` to stage a build on a private preview URL without touching the
live site, then `volly draft publish` to ship it (or `volly draft discard`).

Deploys run as a background job: `volly deploy` triggers it and then polls until
the build is live (exit 0) or fails (exit non-zero) — so it stays drop-in for
CI. Pass `--no-wait` to return as soon as the deploy is queued, printing the job
id and eventual URL instead of waiting.

## GitHub Action

This repo doubles as a composite action. Mint a token once
(`volly token create --name github-actions`), store it as a secret, and:

```yaml
- uses: actions/checkout@v7
- name: Deploy to Volly
  id: deploy
  uses: volly-app/volly-cli@v1
  with:
    token: ${{ secrets.VOLLY_TOKEN }}
    path: ./dist
    app: my-app # optional when ./dist has a volly.json
    message: ${{ github.event.head_commit.message }}
    # draft: 'true'      # stage a preview instead of publishing
- run: echo "Deployed to ${{ steps.deploy.outputs.url }}"
```

Inputs: `token` (required), `path`, `app`, `draft`, `message`, `create`
(default `'true'`), `api-url`, `cli-version`. Outputs: `url`,
`deployment-id`, `draft`. The deploy URL also lands in the job summary.

## Scripting / other CI

The CLI works anywhere Node 20+ does:

```yaml
- name: Deploy to Volly
  env:
    VOLLY_TOKEN: ${{ secrets.VOLLY_TOKEN }}
  run: npx @volly-app/cli deploy ./dist --yes
```

`VOLLY_TOKEN` beats any stored login, prompts are refused without `--yes`
(exit 2), and `--json` output is stable for scripting.

Exit codes: `0` success · `1` error · `2` usage · `3` authentication ·
`4` not found.

## Development

```sh
npm install
npm test              # vitest (no network; fake API servers)
npm run dev -- --help # run from source (tsx)
npm run build         # compile to dist/
```
