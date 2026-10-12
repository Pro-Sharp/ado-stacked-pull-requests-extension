import { describe, expect, it } from "vitest";
import { dirName, fileName, initials, shortDate, shortSha, timeAgo } from "../src/ui/common/format";

describe("format helpers", () => {
  const now = new Date("2026-10-12T12:00:00Z");

  it("builds initials", () => {
    expect(initials("Balázs Csiaki")).toBe("BC");
    expect(initials("Cher")).toBe("CH");
    expect(initials(undefined)).toBe("?");
  });

  it("renders relative times", () => {
    expect(timeAgo(new Date("2026-10-12T11:59:50Z"), now)).toBe("Just now");
    expect(timeAgo(new Date("2026-10-12T11:55:00Z"), now)).toBe("5 minutes ago");
    expect(timeAgo(new Date("2026-10-12T10:00:00Z"), now)).toBe("2 hours ago");
    expect(timeAgo(new Date("2026-10-10T12:00:00Z"), now)).toBe("2 days ago");
    expect(timeAgo(undefined, now)).toBe("");
  });

  it("renders short dates without the year in the current year", () => {
    expect(shortDate(new Date(2026, 9, 5), now)).toBe("Oct 5");
    expect(shortDate(new Date(2025, 8, 19), now)).toBe("Sep 19, 2025");
  });

  it("splits paths and shortens shas", () => {
    expect(fileName("/docs/research/a.md")).toBe("a.md");
    expect(dirName("/docs/research/a.md")).toBe("/docs/research");
    expect(dirName("/a.md")).toBe("/");
    expect(shortSha("12fdd4bdaaaa")).toBe("12fdd4bd");
  });
});
