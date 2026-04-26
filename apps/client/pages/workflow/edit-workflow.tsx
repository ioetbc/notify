import { useParams } from 'react-router-dom';
import { Canvas } from '../canvas';

export function EditWorkflowPage() {
  const { id } = useParams<{ id: string }>();

  return <Canvas workflowId={id!} />;
}
