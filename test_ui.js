const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  try {
    console.log("Navigating to Code Arena...");
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });

    console.log("Waiting for submit button...");
    await page.waitForFunction(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.innerText.includes('Submit Strategy'));
    });

    console.log("Clicking Submit Strategy & Backtest...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.includes('Submit Strategy'));
      if (btn) btn.click();
    });

    console.log("Waiting for navigation to dashboard...");
    // We should transition to /calculating and then eventually to /leaderboard or the main dashboard
    // Let's just take screenshots every 3 seconds for 15 seconds
    
    for (let i = 1; i <= 5; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const p = path.join(__dirname, `screenshot_${i}.png`);
        await page.screenshot({ path: p });
        console.log(`Saved ${p}`);
    }

  } catch (err) {
    console.error("Puppeteer Error:", err);
  } finally {
    await browser.close();
  }
})();
