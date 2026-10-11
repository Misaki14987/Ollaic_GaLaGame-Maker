import { Navigate, useParams, useSearchParams } from 'react-router';

/** Keep saved production links opening the unified editing workspace. */
export function FlowBoardPage() {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams(searchParams);
  next.set('agent', 'workflow');
  return <Navigate replace to={projectId ? `/editor/${projectId}?${next}` : '/'} />;
}
