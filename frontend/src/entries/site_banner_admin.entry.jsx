import React from 'react';
import ReactDOM from 'react-dom/client';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import SiteBannerAdmin from '../pages/SiteBannerAdmin.jsx';
import '../App.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SiteBannerAdmin />
    </ErrorBoundary>
  </React.StrictMode>,
);