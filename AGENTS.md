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

---

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.
When asked about Svelte or SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.
After calling the list-sections tool, you MUST analyze the returned documentation sections (especially the use_cases field) and then use the get-documentation tool to fetch ALL documentation sections that are relevant for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.
You MUST use this tool whenever writing Svelte code before sending it to the user. Keep calling it until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code.
After completing the code, ask the user if they want a playground link. Only call this tool after user confirmation and NEVER if code was written to files in their project.
