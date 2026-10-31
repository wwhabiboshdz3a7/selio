import { expect, test, type Page } from "@playwright/test";

/**
 * Héros « constellation » de l'accueil : interactions réelles (pas seulement le
 * balisage). Cartes cliquables pendant la visite, lien d'évitement visible au
 * clavier, aucune boucle d'animation qui survit à la page, titre affiché vite,
 * retour arrière sans intro rejouée, téléphone en paysage.
 */

/** Place la visite à la progression p (0 = héros, 1 = quinzième carte). */
async function tourTo(page: Page, p: number): Promise<void> {
  await page.evaluate((p) => {
    const track = document.querySelector<HTMLElement>('[data-cst="track"]');
    if (!track) throw new Error("piste absente");
    const stickyTop = parseFloat(getComputedStyle(document.querySelector<HTMLElement>('[data-cst="stage"]')!).top) || 0;
    const top = track.getBoundingClientRect().top + window.scrollY - stickyTop;
    const distance = track.offsetHeight - (window.innerHeight - stickyTop);
    window.scrollTo({ top: top + p * distance, behavior: "instant" });
  }, p);
}

async function liveHero(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator(".cst-root")).toHaveAttribute("data-mode", "live");
  // Le moteur a pris la main (intro en cours ou terminée).
  await expect(page.locator(".cst-root")).not.toHaveAttribute("data-intro", "pending");
}

test.describe("constellation de l'accueil", () => {
  test("les cartes de la visite se cliquent (le HUD ne les recouvre pas)", async ({ page }) => {
    await liveHero(page);
    await tourTo(page, 0.45);
    await page.waitForTimeout(1200);
    const target = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>(".cst-card-item")]
        .map((li) => ({ li, o: Number(getComputedStyle(li).opacity) }))
        .sort((a, b) => b.o - a.o);
      const best = items[0]!.li;
      const r = best.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y)?.closest("a")?.getAttribute("href") ?? null;
      return { x, y, href: best.querySelector("a")!.getAttribute("href")!, hit };
    });
    expect(target.hit).toBe(target.href);
    const touch = (page.viewportSize()?.width ?? 1280) < 768;
    if (touch) await page.touchscreen.tap(target.x, target.y);
    else await page.mouse.click(target.x, target.y);
    await expect(page).toHaveURL(new RegExp(`${target.href.replace("#", "\\#")}$`));
  });

  test("clavier : le lien d'évitement est visible au focus et mène à la suite", async ({ page }) => {
    await liveHero(page);
    await page.locator(".cst-hero .cst-ghost").focus();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Passer la visite des fonctionnalités" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    const opacity = await skip.evaluate((el) => {
      let o = 1;
      for (let e: Element | null = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity);
      return o;
    });
    expect(opacity).toBeGreaterThan(0.9);
    await page.keyboard.press("Enter");
    await expect(page.locator("#application")).toBeInViewport();
  });

  test("le titre s'affiche sans attendre le moteur (LCP < 2,5 s)", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __lcp: number }).__lcp = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) (window as unknown as { __lcp: number }).__lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(4500);
    const lcp = await page.evaluate(() => (window as unknown as { __lcp: number }).__lcp);
    expect(lcp).toBeGreaterThan(0);
    expect(lcp).toBeLessThan(2500);
  });

  test("aucune boucle d'animation ne survit à la page", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __raf: number };
      w.__raf = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => {
        w.__raf++;
        return orig(cb);
      };
    });
    await liveHero(page);
    await page.waitForTimeout(1500);
    await page.goto("/tarifs");
    await page.waitForTimeout(1500);
    const n0 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    await page.waitForTimeout(1000);
    const n1 = await page.evaluate(() => (window as unknown as { __raf: number }).__raf);
    expect(n1 - n0).toBeLessThan(3);
  });

  test("retour arrière en pleine visite : l'intro ne rejoue pas, les cartes sont là", async ({ page }) => {
    await liveHero(page);
    await tourTo(page, 0.45);
    await page.waitForTimeout(900);
    await page.goto("/fonctionnalites");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(page.locator(".cst-root")).toHaveAttribute("data-intro", "done");
    // Même si le navigateur remet la page en haut, aucune intro ne rejoue en pleine visite.
    await tourTo(page, 0.45);
    await page.waitForTimeout(700);
    const visible = await page.evaluate(() => [...document.querySelectorAll(".cst-card-item")].filter((li) => Number(getComputedStyle(li).opacity) > 0.5).length);
    expect(visible).toBeGreaterThan(0);
  });

  test("téléphone en paysage : grille fixe lisible, sans débordement", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto("/");
    await expect(page.locator(".cst-root")).toHaveAttribute("data-mode", "static");
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(overflow).toBe(false);
    await ctx.close();
  });

  test("en-tête nuit sur le ciel, porcelaine ensuite", async ({ page }) => {
    await liveHero(page);
    const header = page.locator("header.mk-header");
    await expect(header).toHaveAttribute("data-over-night", "true");
    await page.locator("#application").scrollIntoViewIfNeeded();
    await page.evaluate(() => document.getElementById("parcours")?.scrollIntoView());
    await expect(header).not.toHaveAttribute("data-over-night", "true");
  });
});
