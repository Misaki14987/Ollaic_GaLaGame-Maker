import { RouterProvider } from 'react-router';
import { router } from './routes';

export default function App() {
  return (
    <div className="size-full overflow-hidden font-body-family">
      <RouterProvider router={router} />
    </div>
  );
}