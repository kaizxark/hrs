import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Mobile Navigation & CSS invariants", () => {
  const cssPath = path.resolve(__dirname, "../index.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  it("does not set zoom on body which breaks mobile fixed/sticky positioning and viewport calculations", () => {
    // Body should not have zoom: 1.1 or any non-100% zoom
    const bodyZoomRegex = /body\s*\{[^}]*zoom:\s*1\.[0-9]+/i;
    expect(cssContent).not.toMatch(bodyZoomRegex);
  });

  it("does not hide the mobile hamburger button with display: none !important in mobile media queries", () => {
    // There shouldn't be .mobile-menu-button { display: none !important }
    expect(cssContent).not.toMatch(/\.mobile-menu-button\s*\{[^}]*display:\s*none\s*!important/i);
  });

  it("does not permanently hide desktop-nav with display: none !important in mobile media queries", () => {
    // desktop-nav shouldn't be forced display: none !important
    expect(cssContent).not.toMatch(/\.desktop-nav\s*\{[^}]*display:\s*none\s*!important/i);
  });

  it("defines mobile navigation styles for 5-slot bottom bar", () => {
    expect(cssContent).toContain(".mobile-bottom-nav");
    expect(cssContent).toContain("grid-template-columns: repeat(5, 1fr)");
    expect(cssContent).toContain(".emergency-tab");
    expect(cssContent).toContain(".emergency-tab-icon");
  });
});
