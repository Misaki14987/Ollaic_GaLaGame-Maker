import { expect, test, type Page } from '@playwright/test';

async function openFlowBoard(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    const now = Date.now();
    const run = {
      runId: 'run_qa',
      projectPath: '/tmp/flow-qa',
      prompt: '近未来校园中，两位创作者共同完成一部视觉小说',
      status: 'paused',
      startedAt: now - 32_000,
      updatedAt: now - 2_000,
      steps: [
        {
          def: { id: 'plan', kind: 'plan', dependsOn: [], agent: null, prompt: '提炼故事冲突' },
          status: 'succeeded',
          attempt: 1,
          output: '{"synopsis":"共同创作让两人重新理解彼此"}',
          error: null,
          startedAt: now - 30_000,
          finishedAt: now - 22_000,
          history: [{
            attempt: 1,
            inputSnapshot: '{"prompt":"近未来校园"}',
            output: '{"synopsis":"共同创作让两人重新理解彼此"}',
            error: null,
            startedAt: now - 30_000,
            finishedAt: now - 22_000,
            durationMs: 8_000,
            diff: 'synopsis updated',
            cost: 0.003,
            warnings: [],
            downgrade: null,
          }],
        },
        {
          def: { id: 'outline', kind: 'outline', dependsOn: ['plan'], agent: null, prompt: '生成三章结构' },
          status: 'pending',
          attempt: 0,
          output: null,
          error: null,
          startedAt: null,
          finishedAt: null,
          history: [],
        },
      ],
    };
    const plan = {
      version: 2,
      prompt: run.prompt,
      synopsis: '共同创作让两位主角重新理解彼此。',
      memory: { worldbook: '' },
      chapters: [{ id: 'chapter-1', title: '重逢', summary: '制作开始' }],
      scenes: [],
      pipelineRuns: [],
    };

    localStorage.setItem('project-path-alpha', '/tmp/flow-qa');
    let callbackId = 1;
    const callbacks = new Map<number, ((data: unknown) => void) | undefined>();
    const runtime = window as typeof window & {
      __TAURI_INTERNALS__: Record<string, unknown>;
      __TAURI_EVENT_PLUGIN_INTERNALS__: Record<string, unknown>;
    };
    runtime.__TAURI_INTERNALS__ = {
      transformCallback(callback: ((data: unknown) => void) | undefined) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback(id: number) { callbacks.delete(id); },
      async invoke(command: string, args: Record<string, unknown> = {}) {
        if (command === 'pipeline_list_runs') return [run];
        if (command === 'pipeline_get_plan') return plan;
        if (command === 'pipeline_get_state') return run;
        if (command === 'plugin:event|listen') return args.handler;
        if (command === 'plugin:event|unlisten') return undefined;
        return undefined;
      },
      convertFileSrc(path: string) { return path; },
    };
    runtime.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) { callbacks.delete(id); },
    };
  });
  await page.goto('/#/flow/alpha');
  await expect(page.getByTestId('flow-run-status')).toContainText('已暂停');
}

test('FlowBoard supports real node dragging and desktop inspection', async ({ page }) => {
  await openFlowBoard(page, { width: 1440, height: 900 });

  await expect(page.getByText('共同创作让两位主角重新理解彼此。')).toBeVisible();
  await expect(page.getByText('run_qa')).toBeVisible();
  const planNode = page.locator('[data-step-id="plan"]');
  const before = await planNode.boundingBox();
  expect(before).not.toBeNull();
  await planNode.hover();
  await page.mouse.down();
  await page.mouse.move((before?.x ?? 0) + 260, (before?.y ?? 0) + 150, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem('ollaic:flow-layout:%2Ftmp%2Fflow-qa:run_qa');
    return raw ? Object.keys(JSON.parse(raw)).length : 0;
  })).toBeGreaterThan(0);

  await planNode.click();
  await expect(page.getByRole('complementary', { name: 'plan 步骤检查器' })).toBeVisible();
  await expect(page.getByRole('region', { name: '生产事件账本' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('FlowBoard inspector remains contained on a narrow viewport', async ({ page }) => {
  await openFlowBoard(page, { width: 430, height: 900 });
  await page.locator('[data-step-id="outline"]').click();

  const inspector = page.getByRole('complementary', { name: 'outline 步骤检查器' });
  await expect(inspector).toBeVisible();
  const box = await inspector.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(430);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
  await page.getByRole('button', { name: '关闭步骤检查器' }).click();
  await expect(inspector).toBeHidden();
});
