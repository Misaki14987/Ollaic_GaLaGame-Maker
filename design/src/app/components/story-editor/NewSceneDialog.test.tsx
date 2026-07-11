import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewSceneDialog } from './NewSceneDialog';

describe('NewSceneDialog', () => {
  it('validates names and creates a normalized scene', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();
    render(
      <NewSceneDialog
        open
        existingScenes={['start.txt']}
        onOpenChange={onOpenChange}
        onCreate={onCreate}
      />,
    );

    const input = screen.getByLabelText('场景文件名');
    await user.type(input, 'bad/name');
    await user.click(screen.getByRole('button', { name: '创建场景' }));
    expect(screen.getByText(/文件名不能包含/)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, 'chapter_02');
    await user.click(screen.getByRole('button', { name: '创建场景' }));
    expect(onCreate).toHaveBeenCalledWith('chapter_02.txt');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
