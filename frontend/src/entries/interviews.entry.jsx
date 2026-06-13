import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import { InterviewsPage } from '../pages/interviews.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <InterviewsPage />
    </ErrorBoundary>
  </React.StrictMode>,
);
