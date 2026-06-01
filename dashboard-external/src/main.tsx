import ReactDOM from 'react-dom/client';
import './global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/clients/queryClient';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>,
);
