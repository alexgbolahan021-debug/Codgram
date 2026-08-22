# Codgram V2.1

Codgram is a **local-first, personal AI coding agent** for a single developer’s projects. It runs on the same computer as the projects it inspects, plans and applies bounded changes in one selected workspace, records reviewable evidence, and never automatically pushes or deploys.

> **Use Codgram only on a computer you control and only with projects you trust.** It is not a hosted repository operator or multi-user service.

## Safety model

| Stage | Codgram behavior | Safety boundary |
| --- | --- | --- |
| Workspace selection | Inspects a selected local project. | The desktop shell selects a directory through the operating system and locks the runtime to that project. |
| Planning | Builds a concise plan from limited, redacted project context. | Codgram does not send the full repository by default. |
| Changes | Uses structured file, terminal, and Git tools. | File paths remain inside the selected workspace; secrets, private keys, dependency directories, Git metadata, and common outputs are blocked. |
| Confirmation | Pauses before higher-impact local operations. | Deletes, dependency changes, local branches, and local commits require explicit approval. |
| Review and rollback | Saves activities, diffs, command outcomes, reports, and a pre-change file checkpoint locally. | Rollback is explicit, one-time, workspace-bounded, and rejects conflicts rather than overwriting newer work. |

## Desktop application and installers

Codgram ships an Electron desktop shell with context isolation, no renderer Node.js access, and a narrow bridge limited to reading selected-workspace state and opening the operating-system folder picker. Choose the project directory itself with **Choose folder directly**; the shell starts the local server using that project’s parent as its workspace root and locks the session to the selected project.

The V2.1 package configuration produces the following installer artifacts in `release/`.

| Platform | Artifacts | Command |
| --- | --- | --- |
| macOS | DMG and ZIP | `pnpm desktop:package:mac` |
| Windows | NSIS installer for x64 and ARM64 | `pnpm desktop:package:win` |
| Linux | AppImage, DEB, and RPM | `pnpm desktop:package:linux` |
| All configured targets | Platform-specific artifacts | `pnpm desktop:package` |

For a fast local packaging smoke check that does not create an installer, run `pnpm desktop:build`. Build distributable artifacts on their native operating system in CI or on a release machine whenever practical. macOS signing and notarization require an Apple signing identity and the applicable Apple credentials; Windows distribution requires an Authenticode signing certificate. Electron Builder accepts these secrets from the release environment, commonly through `CSC_LINK` and `CSC_KEY_PASSWORD`; macOS notarization additionally requires the Apple credentials supported by the release process. Do not commit certificates, passwords, Apple credentials, or provider credentials to this repository.

## Local provider setup and desktop onboarding

Start the development shell with:

```bash
pnpm install
pnpm desktop:dev
```

On first native desktop launch, Codgram presents a short onboarding flow that lets the user select the built-in provider or an OpenAI-compatible endpoint, choose a model preference, and retain the selected safety settings locally. The onboarding interface **never asks for, stores, renders, or logs a raw API key**. Model availability is queried by the local server, not by browser code.

For an OpenAI-compatible provider, configure the local server environment before starting Codgram:

```bash
CODGRAM_WORKSPACE_ROOT=/absolute/path/to/your/projects \
CODGRAM_OPENAI_BASE_URL=https://your-provider.example/v1 \
CODGRAM_OPENAI_API_KEY=your-local-secret \
CODGRAM_OPENAI_MODEL=your-model-id \
pnpm desktop:dev
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `CODGRAM_WORKSPACE_ROOT` | Browser/local-server mode only | Absolute trusted parent directory containing selectable projects. The native shell derives this from the selected project. |
| `CODGRAM_DATA_DIR` | No | Location for local settings, run history, and redacted logs. Defaults to `~/.codgram`. |
| `CODGRAM_OPENAI_BASE_URL` | OpenAI-compatible provider only | Compatible API base URL, without a trailing slash. |
| `CODGRAM_OPENAI_API_KEY` | OpenAI-compatible provider only | **Server-only local credential.** Never place it in the dashboard, browser storage, Git, run history, or logs. |
| `CODGRAM_OPENAI_MODEL` | OpenAI-compatible provider only | Default model ID when the configured preference is `default`. |

For the V1 migration only, corresponding `CORTEX_*` variables remain lower-priority fallbacks when a `CODGRAM_*` variable is absent. New setups must use the Codgram names.

## Per-run rollback checkpoints

Codgram creates a rollback checkpoint when each run begins. For every tracked file mutation, it preserves the file’s state immediately before the run’s first change and records the latest file state expected after the run. The final review presents the affected-file count and an explicit **Restore checkpoint** action once the run has completed, failed, or been stopped.

Restoring requires a second confirmation. Before changing anything, Codgram checks every tracked file still matches the run’s recorded post-change content. If any file differs, restore stops before writing any file and reports that it will not overwrite newer work. A successful checkpoint is intentionally one-time.

Rollback covers only tracked file changes. It cannot undo untracked terminal side effects, installed dependencies, database changes, network operations, or external services. Review the completion report and working tree before and after a restore.

## Local development and verification

```bash
pnpm check
pnpm test
pnpm build
pnpm desktop:check
pnpm desktop:smoke:v21
pnpm exec electron-builder --dir --linux --x64
```

The test suite covers workspace containment, secret redaction, terminal/Git constraints, structured tool-call handling, confirmation outcomes, provider onboarding persistence without credential fields, installer configuration, checkpoint first-state capture, conflict-safe workspace restoration, and one-time runtime rollback. The native V2.1 smoke command uses isolated temporary data and projects to select the OpenAI-compatible provider and a model preference without a credential field, reload completed onboarding to prove it stays dismissed, and exercise both successful and conflict-refused checkpoint restoration.

## Recommended first run

Use a throwaway project first. Ask Codgram to inspect the architecture or make a small well-tested change, review every tracked diff and command result, and test the checkpoint restore flow before using it on an important project.
