# Codgram V1

Codgram is a **local-first personal AI coding-agent dashboard**. It inspects a selected project inside an explicitly configured workspace root, creates a reviewable plan, applies tracked edits, runs bounded development commands, and produces a concise completion report. Codgram is deliberately not a multi-user service, deployment platform, or autonomous remote operator.

> **Run Codgram on the same computer that holds the projects you intend it to inspect.** A hosted deployment cannot safely access your local folders or terminal and is not an appropriate operating mode for this application.

## Operating model

| Stage | Codgram behavior | Safety boundary |
| --- | --- | --- |
| Inspect | Detects project markers, framework, language, package manager, and Git availability. | Only projects directly beneath `CODGRAM_WORKSPACE_ROOT` are selectable. |
| Plan | Requests a concise implementation plan from the configured provider. | Relevant inspection data and recent redacted observations are selectively assembled; the whole repository is not sent to the model. |
| Act | Uses structured workspace, terminal, and Git tools. | File paths must resolve inside the selected workspace. Secret-bearing files and generated/dependency directories are blocked. |
| Verify | Records build, test, lint, typecheck, and Git inspection output. | Shell chaining, arbitrary executables, development servers, remote push, and deployment are blocked. |
| Review | Persists activities, file changes, diffs, commands, and a final report locally. | Logs redact secret-shaped values and private-key material. |

## Local setup

Install dependencies and point Codgram at a directory containing the projects you trust it to work on. The workspace root should contain project folders directly, such as `/Users/you/Projects/my-app` or `/home/you/Projects/my-app`.

```bash
pnpm install
CODGRAM_WORKSPACE_ROOT=/absolute/path/to/your/projects pnpm dev
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `CODGRAM_WORKSPACE_ROOT` | Yes | Absolute path of the trusted parent directory containing selectable projects. Codgram rejects traversal outside this directory. |
| `CODGRAM_DATA_DIR` | Optional | Location for local settings, run history, and redacted NDJSON logs. Defaults to `~/.codgram`. |
| `CODGRAM_OPENAI_BASE_URL` | Only for the OpenAI-compatible provider | API base URL, without a trailing slash. |
| `CODGRAM_OPENAI_API_KEY` | Only for the OpenAI-compatible provider | Server-only API credential. Never put it in the dashboard, browser storage, Git, run history, or logs. |
| `CODGRAM_OPENAI_MODEL` | Only for the OpenAI-compatible provider | Default model ID used when the dashboard model choice is `default`. |

For the V1-to-Codgram migration only, the previous `CORTEX_*` environment variables remain accepted as a lower-priority fallback when their `CODGRAM_*` replacement is absent. Set the `CODGRAM_*` names for all new local setups; the fallback may be removed in a future major version.

Codgram also supports the platform-provided built-in provider in the managed development environment. Use the Settings view to select the provider and active model; credentials are intentionally not configurable in the interface.

## V2 native desktop shell

Codgram V2 includes an Electron desktop shell for **direct project-folder selection**. Start it from a local clone on the same computer that holds your trusted projects:

```bash
pnpm install
pnpm desktop:dev
```

Use **Choose folder directly** in the desktop dashboard and select the project directory itself. Codgram starts its local server with the selected project’s parent directory as the workspace root and locks the session to that one project identifier. The renderer has no Node.js access: its narrow preload bridge can only request workspace state or open the operating-system directory chooser. The selected filesystem path is not displayed in the dashboard or passed to the model.

The initial V2 shell is a local development shell rather than a signed installer. Before distributing a packaged desktop application, add platform-specific code signing, updater configuration, and packaging metadata.

## Safety controls

Codgram permits directory listing, reading, searching, tracked writing, exact-text editing, and deletion only inside the selected workspace. It blocks `.env` files, credential-like files, private keys, Git metadata, dependency directories, and common build outputs from agent context. Delete operations, dependency changes, local branch creation, and local commits require an explicit confirmation dialog. Codgram never calls a Git push command and does not implement deployment tools.

Terminal execution is restricted to a single `npm`, `pnpm`, `yarn`, or `bun` command and rejects shell separators, redirects, substitutions, arbitrary executables, and long-running development-server scripts. Each accepted command is time-bounded, redacted, and recorded for final review.

## Current V1 scope

The local dashboard includes provider selection, safe workspace selection, stack inspection, model-guided planning, structured tool calls, confirmation pauses, a stop control, live activity history, diff review, local run history, and a provider-agnostic agent runtime. It does not package a native desktop shell yet. Run the dashboard locally in a browser as the first-stage local runtime.

## Verification

Run the following before using Codgram against a valuable project.

```bash
pnpm check
pnpm test
pnpm build
pnpm desktop:check
```

The test suite covers workspace containment, secret redaction, command classification, selective context assembly, structured-tool-call failures, confirmation approval and rejection, recoverable tool errors, and a successful model-guided file-change loop.

## Recommended first run

Start with a throwaway project inside `CODGRAM_WORKSPACE_ROOT`. Ask Codgram to inspect its architecture or make a small well-tested change. Review every file diff, terminal result, and final report before approving any higher-impact action.
