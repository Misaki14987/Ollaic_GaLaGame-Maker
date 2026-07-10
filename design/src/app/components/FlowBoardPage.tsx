import { AlertTriangle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { FlowBoard } from './FlowBoard';
import { Button } from './ui/button';
import { StoryOsSideNav, StoryOsTopBar } from './StoryOsChrome';

export function FlowBoardPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projectPath = projectId
    ? localStorage.getItem(`project-path-${projectId}`) ?? ''
    : '';

  return (
    <div className="story-shell h-full overflow-hidden">
      <StoryOsTopBar title="Agent Flow" />
      <StoryOsSideNav
        active="flow"
        projectId={projectId}
        projectLabel={projectPath.split('/').pop() || 'ALPHA'}
      />
      <main className="story-os-workspace min-h-0 bg-surface-container-lowest">
        {projectPath ? (
          <FlowBoard projectPath={projectPath} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="mb-4 text-sm text-muted-foreground">项目路径不可用</p>
              <Button variant="outline" onClick={() => navigate('/')}>返回项目列表</Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
