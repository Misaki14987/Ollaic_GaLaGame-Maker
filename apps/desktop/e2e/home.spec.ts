import { expect, test } from '@playwright/test';

test('project home renders creation entry points', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: '创建新项目' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /打开已有项目/ })).toBeVisible();
  await expect(page.getByPlaceholder('搜索项目...')).toBeVisible();
});
