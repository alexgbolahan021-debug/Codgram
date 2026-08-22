# Optional Local Provider Secret Storage

Codgram currently treats provider secrets as local server environment configuration. This remains the default because it keeps raw credentials out of renderer memory, browser storage, local settings, histories, and logs. An optional native-desktop keychain feature may be added only as a separately reviewed capability.

## Security objective

The feature must let a single local user store an OpenAI-compatible provider secret in the operating system’s protected credential facility while preserving Codgram’s existing renderer isolation. It must **not** turn the dashboard into a general secret viewer, secret exporter, or browser-storage client.

| Boundary | Required design |
| --- | --- |
| Renderer | Can submit a secret once to a narrow IPC action, receive success/failure, and request non-sensitive configuration status. It cannot read an existing secret, enumerate secrets, or receive encrypted ciphertext. |
| Preload bridge | Exposes only `saveProviderSecret`, `clearProviderSecret`, and `getProviderSecretStatus`; validates provider identifiers and rejects arbitrary key names. |
| Main process | Uses Electron `safeStorage` only after checking `safeStorage.isEncryptionAvailable()`. It owns encryption/decryption and never writes raw secrets to console output. |
| Local storage | Stores ciphertext plus a minimal versioned reference in a private local app-data file with restrictive permissions. It never uses `localStorage`, IndexedDB, run history, settings JSON, or the workspace. |
| Local server | Receives the plaintext only in process memory when a run needs the selected provider. It redacts errors and does not return the value through an RPC response. |
| Logs and diagnostics | Continue applying secret redaction. Do not log provider request headers, IPC arguments, ciphertext, or environment snapshots. |

## Recommended implementation sequence

First, extend the Electron main process and preload contract with typed, provider-specific IPC calls. The renderer should show an opt-in **Store locally in system keychain** action only after a user has chosen the OpenAI-compatible provider. The entry field must use a password control, clear its value immediately after submission, disable browser autofill where appropriate, and never place the value in React query caches, toasts, analytics, or error strings.

Second, use `safeStorage.encryptString` and `safeStorage.decryptString` only when encryption is available. On Linux, availability depends on the desktop environment’s secret-service support; when it is unavailable, Codgram should retain the environment-variable setup path and explain that protected local storage is not available. It must not fall back to weak reversible encoding or a plaintext file.

Third, pass the decrypted secret from Electron main to the local server through a narrowly scoped launch-time channel or a one-shot, authenticated local IPC route. Avoid expanding the existing renderer bridge. The persisted Codgram settings record should store only provider choice, model preference, and a boolean such as `providerSecretStored`; it must not store a credential, ciphertext, keychain account name, or endpoint authorization header.

Finally, add tests for unavailable encryption, save/replace/clear behavior, renderer API non-disclosure, no-secret log redaction, and server process restart behavior. A security review should precede enabling the feature by default.

> **Decision:** This release-automation update intentionally does not add native secret persistence. It documents a bounded implementation plan and preserves the safer server-environment configuration path until the explicit IPC, storage, and review work is implemented and tested.

## References

[1] [Electron `safeStorage` API](https://www.electronjs.org/docs/latest/api/safe-storage)

[2] [Electron Process Security](https://www.electronjs.org/docs/latest/tutorial/security)
