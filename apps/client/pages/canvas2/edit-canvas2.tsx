import { useParams } from 'react-router-dom';
import { Canvas2 } from './canvas2';

export function EditCanvas2Page() {
  const { id } = useParams<{ id: string }>();
  return <Canvas2 workflowId={id!} />;
}
