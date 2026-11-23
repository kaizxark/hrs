import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Navigation & CSS invariants", () => {
  const cssPath = path.resolve(__dirname, "../index.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");
  const mobileNavPath = path.resolve(__dirname, "./MobileBottomNav.tsx");
  const mobileNavContent = fs.readFileSync(mobileNavPath, "utf-8");
  const siteHeaderPath = path.resolve(__dirname, "./SiteHeader.tsx");
  const siteHeaderContent = fs.readFileSync(siteHeaderPath, "utf-8");

  it("does not set zoom on body which breaks mobile fixed/sticky positioning and viewport calculations", () => {
    const bodyZoomRegex = /body\s*\{[^}]*zoom:\s*1\.[0-9]+/i;
    expect(cssContent).not.toMatch(bodyZoomRegex);
  });

  it("does not have active indicator line in desktop nav", () => {
    expect(cssContent).not.toMatch(/\.desktop-nav\s+\.active::after/i);
  });

  it("defines 3-slot centered floating pill for mobile bottom navigation", () => {
    expect(cssContent).toContain(".mobile-bottom-nav");
    expect(cssContent).toContain("grid-template-columns: repeat(3, 1fr)");
    expect(cssContent).toContain(".emergency-tab");
    expect(cssContent).toContain(".emergency-tab-icon");
  });

  it("does not have register option in MobileBottomNav or SiteHeader", () => {
    expect(mobileNavContent).not.toMatch(/href=["']\/register["']/);
    expect(siteHeaderContent).not.toMatch(/href=["']\/register["']/);
  });

  it("shows About on Home and Home on About in MobileBottomNav", () => {
    expect(mobileNavContent).toContain("isHome ?");
    expect(mobileNavContent).toContain('href="/about"');
    expect(mobileNavContent).toContain('href="/"');
  });

  it("shows About on Home and Home on About in SiteHeader", () => {
    expect(siteHeaderContent).toContain("isHome ?");
    expect(siteHeaderContent).toContain('href="/about"');
    expect(siteHeaderContent).toContain('href="/"');
  });

  it("portals MobileBottomNav to document.body so it stays fixed to the viewport and cannot get stuck in page containers", () => {
    expect(mobileNavContent).toContain("createPortal");
    expect(mobileNavContent).toContain("document.body");
  });

  it("does not expose /register route to public visitors", () => {
    const appPath = path.resolve(__dirname, "../App.tsx");
    const appContent = fs.readFileSync(appPath, "utf-8");
    expect(appContent).not.toMatch(/path=["']\/register["']/);
  });
});
