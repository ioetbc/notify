import { describe, it, expect } from "bun:test";
import { existsSync } from "fs";
import { join } from "path";

describe("unused CSS cleanup", () => {
  it("App.css should not exist (unused Vite template leftover)", () => {
    const appCssPath = join(import.meta.dir, "..", "App.css");
    expect(existsSync(appCssPath)).toBe(false);
  });
});
