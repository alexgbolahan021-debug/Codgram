# Codgram Signed Release CI

Codgram’s `.github/workflows/release.yml` is deliberately **tag- or manually-triggered only**. A version-tag push runs the Linux job only, uploading AppImage, DEB, and RPM artifacts into a draft GitHub release for human review. The credential-dependent macOS and Windows jobs remain disabled until a maintainer manually dispatches the workflow in `full-signed` mode after configuring signing secrets. The workflow does not embed certificates, passwords, tokens, or provider credentials.

> Create and verify a version tag that matches `package.json` before running a release. A failed signing step is the intended behavior when signing secrets are absent or invalid; Codgram must not silently publish an unsigned macOS or Windows build.[1]

## Release modes

| Trigger | Mode | Artifacts | Signing-secret requirement |
| --- | --- | --- | --- |
| Push matching `vX.Y.Z` tag | Linux-first | AppImage, DEB, RPM | None |
| Manual dispatch | `linux-first` | AppImage, DEB, RPM | None |
| Manual dispatch | `full-signed` | Linux artifacts plus macOS and Windows installers | All applicable macOS and Windows signing secrets |

The tag check prevents accidentally publishing an artifact whose package version does not match its tag. Linux artifacts are not code-signed by this workflow; review the draft release before making it public.

## Required repository secrets for full-signed releases

Configure these under **GitHub repository Settings → Secrets and variables → Actions**. Secret values cannot be read back after saving; store the original certificate files and recovery details in the organization’s approved secure vault.[2]

| Secret | Used by | Value format and purpose |
| --- | --- | --- |
| `MAC_CSC_LINK` | macOS | Base64-encoded Developer ID Application `.p12` certificate for direct distribution. |
| `MAC_CSC_KEY_PASSWORD` | macOS | Password used to export/decrypt the `.p12`. |
| `APPLE_ID` | macOS | Apple developer account email used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | macOS | App-specific password created for the Apple ID; never use the primary Apple ID password. |
| `APPLE_TEAM_ID` | macOS | Ten-character Apple Developer Team ID. |
| `WIN_CSC_LINK` | Windows | Base64-encoded exportable OV `.pfx` certificate, when using conventional certificate signing. |
| `WIN_CSC_KEY_PASSWORD` | Windows | Password used to export/decrypt the Windows `.pfx`. |

The workflow uses `github.token` solely to create or update the release and upload artifacts; it has `contents: write` permission only in the release workflow. No personal access token is required for this repository workflow.[3]

## macOS signing and notarization

Obtain a **Developer ID Application** certificate from an active Apple Developer Program membership, export it as a password-protected `.p12`, and encode it for `MAC_CSC_LINK`. Direct macOS distribution requires both code signing and notarization for current Gatekeeper behavior.[1] The current package configuration already enables hardened runtime and records Codgram’s user-selected folder entitlement.

On macOS, the certificate may be encoded with the platform’s base64 utility:

```bash
base64 -i CodgramDeveloperID.p12 | pbcopy
```

Paste the resulting single base64 value into the `MAC_CSC_LINK` secret. Use the export password as `MAC_CSC_KEY_PASSWORD`. Create an app-specific password at the Apple ID portal, then enter the Apple developer email, app-specific password, and team ID as the remaining notarization secrets. Electron Builder consumes these via `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` at runtime; the workflow maps the repository secret names to those environment variables.[1]

## Windows signing

The default workflow supports an **exportable standard OV `.pfx`** certificate. Encode the `.pfx` as base64 and store its password separately. Electron Builder reads `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, and `forceCodeSigning` makes a missing or invalid identity fail the release rather than produce a silently unsigned installer.[1]

Windows certificate and platform rules evolve. If Codgram uses a non-exportable EV certificate or a cloud-backed signing service, do **not** attempt to convert its hardware-bound private key into a GitHub secret. Use the provider’s supported HSM or cloud-signing integration instead, then revise the `windows` job and Electron Builder `win.sign` configuration as one audited change.[1] [4]

## Linux-first release procedure

| Step | Human action | Expected result |
| --- | --- | --- |
| 1 | Confirm `pnpm check`, `pnpm test`, `pnpm desktop:smoke:v21`, and a local package verification pass. | The tagged source is release-ready. |
| 2 | Update `package.json` to the intended semantic version and commit it. | The version and future tag agree. |
| 3 | Create and push matching `vX.Y.Z`. | The Linux runner creates AppImage, DEB, and RPM artifacts in a draft release. |
| 4 | Review the draft GitHub release and Linux artifact names. | A human confirms the draft-release evidence. |
| 5 | Publish the draft release manually. | Linux downloads become public according to repository visibility. |

To add macOS and Windows later, configure the secrets above and manually dispatch the same workflow with `release_mode: full-signed` against the existing tag. That run requires all three platform jobs to succeed before it updates the draft release. The workflow intentionally creates a **draft** release. It never promotes a release automatically, and it does not configure automatic in-app updates. Electron Builder publishing is explicitly disabled in packaging commands; artifact publication happens only after the selected release-mode jobs pass.[3]

## References

[1] [Electron Builder: Code Signing](https://www.electron.build/docs/features/code-signing/)

[2] [GitHub Docs: Using Secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)

[3] [Electron Builder: GitHub Actions CI/CD](https://www.electron.build/docs/features/github-actions/)

[4] [Electron: Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
