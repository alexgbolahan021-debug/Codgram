import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packagePath = path.resolve(import.meta.dirname, "..", "package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8")) as {
  main?: string;
  scripts?: Record<string, string>;
  desktopName?: string;
  build?: { appId?: string; productName?: string; mac?: { target?: string[] }; win?: { target?: Array<{ target: string; arch: string[] }>; signtoolOptions?: { publisherName?: string } }; linux?: { target?: string[]; maintainer?: string; syncDesktopName?: boolean } };
  repository?: { type?: string; url?: string };
};

describe("Codgram desktop packaging", () => {
  it("declares production installer targets for macOS, Windows, and Linux", () => {
    expect(manifest.main).toBe("desktop/main.cjs");
    expect(manifest.build?.appId).toBe("im.codgram.desktop");
    expect(manifest.build?.productName).toBe("Codgram");
    expect(manifest.repository).toEqual({ type: "git", url: "git+https://github.com/alexgbolahan021-debug/Codgram.git" });
    expect(manifest.build?.mac?.target).toEqual(expect.arrayContaining(["dmg", "zip"]));
    expect(manifest.build?.win?.target).toEqual(expect.arrayContaining([expect.objectContaining({ target: "nsis", arch: expect.arrayContaining(["x64", "arm64"]) })]));
    expect(manifest.build?.win?.signtoolOptions?.publisherName).toBe("Codgram");
    expect(manifest.build?.linux?.target).toEqual(expect.arrayContaining(["AppImage", "deb", "rpm"]));
    expect(manifest.desktopName).toBe("codgram");
    expect(manifest.build?.linux).toMatchObject({ maintainer: "Codgram", syncDesktopName: true });
    expect(manifest.scripts?.["desktop:package"]).toContain("electron-builder --mac --win --linux");
  });
});
