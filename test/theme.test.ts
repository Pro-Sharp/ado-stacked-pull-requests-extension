import { describe, expect, it } from "vitest";
import { luminanceOf, themeFromBackground } from "../src/ui/theme";

describe("theme detection", () => {
  it("classifies the host background, not the OS preference", () => {
    expect(themeFromBackground("rgb(255, 255, 255)")).toBe("light");
    expect(themeFromBackground("rgb(248, 248, 248)")).toBe("light");
    expect(themeFromBackground("rgb(27, 26, 25)")).toBe("dark");
    expect(themeFromBackground("rgba(0, 0, 0, 1)")).toBe("dark");
  });

  it("ignores transparent or unreadable colours so the OS fallback applies", () => {
    expect(themeFromBackground("rgba(0, 0, 0, 0)")).toBeUndefined();
    expect(themeFromBackground("transparent")).toBeUndefined();
    expect(luminanceOf("")).toBeUndefined();
  });
});
