import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import { InterviewsAdminPage } from '../pages/interviews_admin.jsx';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <InterviewsAdminPage />
    </ErrorBoundary>
  </React.StrictMode>,
);
