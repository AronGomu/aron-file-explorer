import { expect, test } from "@playwright/test";

for (const theme of ["catppuccin-latte", "catppuccin-mocha"]) {
  test(`renders harness button in ${theme}`, async ({ page }) => {
    await page.goto(
      `/?case=harness-button&theme=${encodeURIComponent(theme)}`,
      { waitUntil: "networkidle" },
    );
    await page.addStyleTag({
      content:
        "*, *::before, *::after { animation: none !important; transition: none !important; }",
    });

    await expect(page.locator("main[data-theme-case='harness-button']")).toBeVisible();
    await expect(page.getByRole("button", { name: "Harness button" })).toBeVisible();
    await page.screenshot({
      path: `artifacts/theme-validation/visual/${theme}-harness-button.png`,
      fullPage: true,
    });
  });
}
