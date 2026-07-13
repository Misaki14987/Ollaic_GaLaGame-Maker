import { AlertTriangle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { FlowBoard } from '@/app/components/flow/FlowBoard';
import { Button } from '@/app/components/ui/button';
import { StoryOsSideNav, StoryOsTopBar } from '@/app/components/shell/StoryOsChrome';
import type { FlowStepView } from '@/app/lib/flow/flow-state';
import type { StoryPlan } from '@/app/lib/flow/pipeline-types';

export function FlowBoardPage() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const projectPath = projectId ? (localStorage.getItem(`project-path-${projectId}`) ?? '') : '';

  const openArtifact = (step: FlowStepView, plan: StoryPlan | null) => {
    if (!projectId) return;
    if (step.kind === 'character') {
      navigate(`/editor/${projectId}/assets?tab=character`);
    } else if (step.kind === 'asset') {
      navigate(`/editor/${projectId}/assets`);
    } else if (step.id === 'scene') {
      const scene = plan?.branches.entryScene
        ? plan.scenePlans.find((candidate) => candidate.id === plan.branches.entryScene)?.file
        : plan?.scenes[0];
      navigate(`/editor/${projectId}${scene ? `?scene=${encodeURIComponent(scene)}` : ''}`);
    }
  };

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
          <FlowBoard projectPath={projectPath} onOpenArtifact={openArtifact} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
              <p className="mb-4 text-sm text-muted-foreground">项目路径不可用</p>
              <Button variant="outline" onClick={() => navigate('/')}>
                返回项目列表
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
