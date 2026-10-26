import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@tauri-apps/plugin-dialog';
import { ProjectHome, type Project } from './ProjectHome';
import { openProject } from '../lib/webgal-ipc';

vi.mock('../lib/webgal-ipc');
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: vi.fn() }));

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

const projects: Project[] = [
  {
    id: 'first',
    name: '雨后站台',
    description: '五年后的重逢',
    lastModified: '2026/10/26 12:00',
    path: '/stories/station',
    isFavorite: false,
    sceneCount: 3,
  },
  {
    id: 'second',
    name: '下一站夏天',
    description: '海边的约定',
    lastModified: '2026/10/25 09:00',
    path: '/stories/summer',
    isFavorite: true,
    sceneCount: 8,
  },
  {
    id: 'archived',
    name: '旧日来信',
    description: '',
    lastModified: '',
    path: '/stories/letter',
    isFavorite: false,
    sceneCount: 1,
    deleted: true,
  },
];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('webgal-projects', JSON.stringify(projects));
  vi.clearAllMocks();
  vi.mocked(openProject).mockImplementation(async (path) => ({ path, config: {}, scenes: [] }));
});
afterEach(cleanup);

describe('M3 project home', () => {
  it('opens a project directly and updates its recent position', async () => {
    const user = userEvent.setup();
    render(<ProjectHome />);
    await user.click(screen.getByRole('button', { name: '打开项目 下一站夏天' }));
    expect(navigate).toHaveBeenCalledWith('/editor/second');
    expect(localStorage.getItem('project-path-second')).toBe('/stories/summer');
    expect(JSON.parse(localStorage.getItem('webgal-projects')!)[0].id).toBe('second');
  });

  it('searches by path and clears unmatched results', async () => {
    const user = userEvent.setup();
    render(<ProjectHome />);
    await user.type(screen.getByRole('searchbox', { name: '搜索项目' }), '/stories/summer');
    expect(screen.getByRole('button', { name: '打开项目 下一站夏天' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开项目 雨后站台' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('searchbox'), '-missing');
    expect(screen.getByText('没有找到匹配的项目')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: '清除搜索' })[0]);
    expect(screen.getByRole('button', { name: '打开项目 雨后站台' })).toBeInTheDocument();
  });

  it('keeps card actions separate from project opening and persists favorites', async () => {
    const user = userEvent.setup();
    render(<ProjectHome />);
    await user.click(screen.getByRole('button', { name: '收藏 雨后站台' }));
    await user.click(screen.getByRole('button', { name: '收藏（2）' }));
    expect(screen.getByRole('button', { name: '打开项目 雨后站台' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消收藏 雨后站台' }));
    expect(screen.queryByRole('button', { name: '打开项目 雨后站台' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开项目 下一站夏天' })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('restores a recycled project from its card without opening it', async () => {
    const user = userEvent.setup();
    render(<ProjectHome />);
    await user.click(screen.getByRole('button', { name: '回收站（1）' }));
    expect(screen.getByRole('button', { name: '打开项目 旧日来信' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '还原项目 旧日来信' }));
    expect(screen.getByText('回收站是空的')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '项目（3）' }));
    expect(screen.getByRole('button', { name: '打开项目 旧日来信' })).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('edits project details from its card and supports Escape to dismiss creation', async () => {
    const user = userEvent.setup();
    render(<ProjectHome />);
    await user.click(screen.getByRole('button', { name: '编辑项目 雨后站台' }));
    const dialog = within(screen.getByRole('dialog', { name: '编辑项目信息' }));
    await user.clear(dialog.getByLabelText('项目名称'));
    await user.type(dialog.getByLabelText('项目名称'), '雨后重逢');
    await user.click(dialog.getByRole('button', { name: '保存修改' }));
    expect(screen.getByRole('button', { name: '打开项目 雨后重逢' })).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^新建项目/ }));
    expect(screen.getByRole('dialog', { name: '新建项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a recoverable error if the native folder picker is unavailable', async () => {
    const user = userEvent.setup();
    vi.mocked(open).mockRejectedValueOnce(new Error('native dialog unavailable'));
    render(<ProjectHome />);
    await user.click(screen.getByRole('button', { name: /^打开已有项目/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('无法打开项目');
    await user.click(screen.getByRole('button', { name: '关闭错误提示' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
