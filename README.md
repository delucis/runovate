# runovate

CLI for managing Renovate update PRs on GitHub

> [!IMPORTANT]
> This CLI can merge PRs on your behalf. Make sure you trust it if you’re using it. It will do its best to be clear and prompt for confirmation before executing actions, but the software is provided "as is" without warranty of any kind.

## Usage

To get started run `runovate` in your Terminal:

```sh
npx runovate
# or pnpm dlx runovate
```

The CLI will prompt you to log in to GitHub, ask which user or org you’re interested in and walk you through your open Renovate PRs.

Run `runovate help` to print usage instructions.

### Options

#### `--org <org_or_username>`

By default, `runovate` will prompt you to enter the GitHub org or username you want to work on. Alternatively you can pass this when running the command using the `--org` option:

```sh
runovate --org my_username
```

#### `--max_prs <count>`

Set the maximum number of PRs you want to work on at a time. Defaults to `100`.

```sh
runovate --max_prs 50
```

#### `--include_private`

By default, `runovate` will only access public repos. If you wish to authenticate with scopes that have access to your private repositories, run `runovate` with the `--include_private` flag:

```sh
runovate --include_private
```

#### `--client_id <id>`

By default, `runovate` will authenticate with GitHub using an OAuth app run by [@delucis](https://github.com/delucis). If you prefer to use your own OAuth app, [create one in your GitHub settings](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app), and provide the client ID when running `runovate`:

```sh
runovate --client_id abcdefghij0123456789
```

### Other commands

#### `help`

Print basic usage instructions to the terminal window.

```sh
runovate help
```

#### `logout`

Clears GitHub credentials stored from previous runs of `runovate`.

```sh
runovate logout
```

#### `version`

Print the current package version to the terminal.

```sh
runovate version
```
