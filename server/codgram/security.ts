import path from "node:path";

const SECRET_LINE = /((?:api|access|auth|private)[_-]?(?:key|token)|password|secret|authorization)\s*[:=]\s*([^\s,;]+)/gi;
const BEARER_TOKEN = /bearer\s+[a-z0-9._\-]+/gi;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function redactSecrets(value: string): string {
  return value
    .replace(PRIVATE_KEY, "[REDACTED PRIVATE KEY]")
    .replace(BEARER_TOKEN, "Bearer [REDACTED]")
    .replace(SECRET_LINE, "$1=[REDACTED]");
}

export function redactUnknown(value: unknown): string {
  if (typeof value === "string") return redactSecrets(value);
  try {
    return redactSecrets(JSON.stringify(value));
  } catch {
    return "[unserializable value]";
  }
}

export function getWorkspaceRoot(): string {
  return path.resolve(process.env.CODGRAM_WORKSPACE_ROOT || process.env.CORTEX_WORKSPACE_ROOT || process.cwd());
}

export function getLockedWorkspaceId(): string | null {
  const configured = process.env.CODGRAM_WORKSPACE_ID?.trim();
  return configured ? normalizeWorkspaceId(configured) : null;
}

export function normalizeWorkspaceId(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized === "." || path.isAbsolute(normalized)) {
    throw new Error("Choose a project inside the configured Codgram workspace root.");
  }
  return normalized;
}

export function resolveInside(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error("Absolute paths are not permitted.");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relation = path.relative(resolvedRoot, resolved);
  if (relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("This operation would leave the selected workspace.");
  }
  return resolved;
}

export function isSensitivePath(relativePath: string): boolean {
  const name = path.basename(relativePath).toLowerCase();
  return (
    name === ".env" ||
    name.startsWith(".env.") ||
    name.includes("credential") ||
    name.includes("secret") ||
    name.endsWith(".pem") ||
    name.endsWith(".key") ||
    name === "id_rsa" ||
    name === "id_ed25519"
  );
}

export function isIgnoredWorkspacePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]/);
  return segments.some(segment =>
    [".git", "node_modules", "dist", "build", ".next", "coverage", ".cache"].includes(segment)
  );
}
