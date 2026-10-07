import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import SystemAdmin from '../pages/SystemAdmin.jsx';
import '../App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SystemAdmin />
    </ErrorBoundary>
  </React.StrictMode>,
);
