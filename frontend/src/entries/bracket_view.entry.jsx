import React from 'react';
import ReactDOM from 'react-dom/client';
import { BracketView } from '../pages/BracketView.jsx';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BracketView />
    </ErrorBoundary>
  </React.StrictMode>,
);
