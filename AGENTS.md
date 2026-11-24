## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, storybook, ai-tools

## Commits & Releases

Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages. Releases and `CHANGELOG.md` are automated by `release-it` with `@release-it/conventional-changelog` (see [.release-it.json](.release-it.json)).

Format: `<type>[optional scope][!]: <description>`

Common types:

- `feat`: new feature (minor bump, added to changelog)
- `fix`: bug fix (patch bump, added to changelog)
- `perf`: performance improvement (patch bump, added to changelog)
- `refactor`: code change that neither fixes a bug nor adds a feature
- `docs`: documentation only
- `test`: adding or updating tests
- `chore`: maintenance, dependencies, tooling
- `build` / `ci`: build system or CI changes

Breaking changes: add `!` after the type/scope (e.g. `feat!: ...`) or include a `BREAKING CHANGE:` footer. This triggers a major bump.

Run `npm run release` to publish a release.

## Code layout

See [devdocs/](devdocs/) for how the viewer, renderer and tile engine fit together. Keep it up to date when a feature changes.

## Svelte

Use the Svelte MCP server (`list-sections`, `get-documentation`) for Svelte 5 / SvelteKit docs, and run `svelte-autofixer` on every Svelte file you change until it reports no issues.
