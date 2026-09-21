import { defineConfig } from '@playwright/test';

const PORT = 8099;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // アニメーションの途中経過に左右されないよう、動きを減らす設定で見る（即座に切り替わる）
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `npx --yes http-server -c-1 -s -p ${PORT} .`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
  },
});
