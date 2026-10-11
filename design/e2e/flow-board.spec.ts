import { expect, test } from '@playwright/test';
import { openFlowBoard } from './fixtures/editor';

test('production checklist opens results, logs, dependency forms and editors', async ({ page }, testInfo) => {
  await openFlowBoard(page, { width: 1440, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('production-desktop.png') });
  await expect(page.getByText('共同创作让两位主角重新理解彼此。')).toBeVisible();
  await expect(page.locator('.react-flow')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '生产事件账本' })).toHaveCount(0);
  await page.getByRole('button', { name: '运行日志' }).click();
  await expect(page.getByRole('region', { name: '生产事件账本' })).toBeVisible();
  await page.getByRole('button', { name: '运行日志' }).click();

  await page.getByRole('button', { name: '查看故事规划' }).click();
  await expect(page.getByRole('tab', { name: '输出' })).toHaveAttribute('data-state', 'active');
  await page.getByRole('button', { name: '关闭步骤检查器' }).click();
  await page.getByRole('button', { name: '查看对白创作' }).click();
  await page.getByText('调整前置步骤').click();
  await page.getByLabel('等待世界观设定').check();
  await page.getByRole('button', { name: '保存前置步骤' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __flowCalls: { command: string; args: Record<string, unknown> }[] }).__flowCalls.filter((call) => call.command === 'pipeline_update_dependencies'))).toEqual([
    { command: 'pipeline_update_dependencies', args: { runId: 'run_qa', projectPath: '/tmp/flow-qa', stepId: 'dialogist', dependsOn: ['character', 'memory'] } },
  ]);
  await page.getByRole('button', { name: '关闭步骤检查器' }).click();
  await page.getByRole('button', { name: '查看角色设计' }).click();
  await page.getByRole('button', { name: '打开角色' }).click();
  await expect(page).toHaveURL(/\/editor\/alpha\/assets\?tab=character$/);
});

test('narrow inspector traps focus, closes with Escape and restores focus', async ({ page }) => {
  await openFlowBoard(page, { width: 430, height: 900 });
  const trigger = page.getByRole('button', { name: '查看章节大纲' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '步骤检查器' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await expect(page.getByRole('button', { name: '关闭步骤检查器' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  const focusedInside = await dialog.evaluate((element) => element.contains(document.activeElement));
  expect(focusedInside).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('draft selection is saved before execution and missing media only blocks selected media', async ({ page }, testInfo) => {
  await openFlowBoard(page, { width: 1024, height: 900 }, 'draft');
  await page.getByLabel('production brief').fill('这次只制作故事内容');
  const prepare = page.getByRole('button', { name: '准备流程' });
  await expect(prepare).toBeEnabled();
  await expect(prepare).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('production-selection.png') });
  const media = page.getByLabel('执行素材生成与绑定');
  await expect(media).not.toBeChecked();
  await media.check();
  await expect(prepare).toBeDisabled();
  await media.uncheck();
  await page.getByLabel('执行世界观设定').uncheck();
  await expect(page.getByLabel('执行章节大纲')).toBeChecked();
  await expect(prepare).toBeDisabled();
  await page.getByRole('button', { name: '取消相关后续步骤' }).click();
  await expect(page.getByLabel('执行世界观设定')).not.toBeChecked();
  await expect(page.getByLabel('执行章节大纲')).not.toBeChecked();
  await prepare.click();
  await expect(page.getByRole('button', { name: '开始生产' })).toBeVisible();
  const calls = await page.evaluate(() => (window as unknown as { __flowCalls: { command: string; args: Record<string, unknown> }[] }).__flowCalls);
  expect(calls.find((call) => call.command === 'pipeline_start')?.args).toEqual({ projectPath: '/tmp/flow-qa', prompt: '这次只制作故事内容', allowLocalFallback: false, selectedStepIds: ['plan'] });
  expect(calls.some((call) => call.command === 'pipeline_resume')).toBe(false);
  await expect(page.locator('[data-step-id]')).toHaveCount(1);
  await expect(page.getByText('0/1 步骤已处理')).toBeVisible();
  await page.getByRole('button', { name: '开始生产' }).click();
  await expect(page.getByTestId('flow-run-status')).toHaveText('生产中');
});

test('draft checklist fits phone width and remains scrollable', async ({ page }, testInfo) => {
  await openFlowBoard(page, { width: 390, height: 844 }, 'draft');
  await page.getByLabel('production brief').fill('窄屏故事');
  await expect(page.getByRole('button', { name: '准备流程' })).toBeEnabled();
  await expect(page.getByRole('button', { name: '准备流程' })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: testInfo.outputPath('production-phone.png') });
  await page.getByLabel('执行素材生成与绑定').scrollIntoViewIfNeeded();
  await expect(page.getByLabel('执行素材生成与绑定')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
