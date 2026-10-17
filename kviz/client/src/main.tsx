import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
  <BrowserRouter basename={window.location.pathname === '/results' ? '/' : '/kviz'}>
      <App />
    </BrowserRouter>
  </StrictMode>
);
