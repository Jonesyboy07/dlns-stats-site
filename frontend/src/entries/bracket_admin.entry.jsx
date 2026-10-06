import React from 'react';
import ReactDOM from 'react-dom/client';
import { BracketAdmin } from '../pages/BracketAdmin.jsx';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BracketAdmin />
    </ErrorBoundary>
  </React.StrictMode>,
);
