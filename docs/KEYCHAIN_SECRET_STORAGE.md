# Optional Local Provider Secret Storage

Codgram continues to support local server environment configuration as the default provider-secret path. Native desktop users may now opt into storing one OpenAI-compatible provider secret with Electron `safeStorage`. This feature remains intentionally narrow: it is not a secret viewer, exporter, endpoint manager, or browser-storage client.

## Security objective

The feature must let a single local user store an OpenAI-compatible provider secret in the operating system’s protected credential facility while preserving Codgram’s existing renderer isolation. It must **not** turn the dashboard into a general secret viewer, secret exporter, or browser-storage client.

| Boundary | Required design |
| --- | --- |
| Renderer | Can submit a secret once to a narrow IPC action, receive success/failure, and request non-sensitive configuration status. It cannot read an existing secret, enumerate secrets, or receive encrypted ciphertext. |
| Preload bridge | Exposes only `saveProviderSecret`, `clearProviderSecret`, and `getProviderSecretStatus`. It accepts no arbitrary secret name, and it cannot read, enumerate, or export existing values. |
| Main process | Uses Electron’s asynchronous safeStorage APIs only after checking their availability. It owns encryption/decryption and never writes raw secrets to console output. |
| Local storage | Stores only base64 ciphertext and a version at `userData/codgram/provider-secret.json`, in a private app-data directory with restrictive permissions. It never uses `localStorage`, IndexedDB, run history, settings JSON, or the workspace. |
| Local server | Receives plaintext only through its launch-time process environment after Electron main decrypts the stored value. Storing or clearing restarts the local server; no RPC response returns the value. |
| Logs and diagnostics | Continue applying secret redaction. Do not log provider request headers, IPC arguments, ciphertext, or environment snapshots. |

## Implemented behavior

The desktop Settings view presents the optional **Protected local provider secret** control only when the OpenAI-compatible provider is selected. Its entry field uses a password control with browser autofill disabled, clears immediately after a successful handoff, and keeps no secret value in React query state, persistent settings, diagnostics, or toast content.

Codgram uses `encryptStringAsync` and `decryptStringAsync`. On Linux, Codgram refuses to store a secret whenever Electron selects the `basic_text` fallback, because that fallback is not OS-protected. The environment-variable setup path remains available on every platform. Electron recommends the asynchronous APIs because they are non-blocking and support key rotation.[1]

The renderer receives only status: whether protected storage is available, whether a value is stored, a selected backend label, and a generic safe message. The persisted Codgram settings record does not contain a credential, ciphertext, keychain account name, endpoint authorization header, or secret-status marker.

Regression tests cover ciphertext-only persistence, status-only return values, clearing, and Linux `basic_text` refusal. This feature remains opt-in; a further independent security review is appropriate before changing that default.

> **Decision:** Codgram implements protected local secret storage only for its native Electron shell and only through OS-backed encryption reported as available by Electron. The safer server-environment configuration remains the default and the only option for browser mode or unsupported Linux secret services.

## References

[1] [Electron `safeStorage` API](https://www.electronjs.org/docs/latest/api/safe-storage)

[2] [Electron Process Security](https://www.electronjs.org/docs/latest/tutorial/security)
