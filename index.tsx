import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { AuthProvider } from './AuthProvider.tsx';
import { SessionTimeout } from './SessionTimeout.tsx';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find the root element to mount the application.");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <AuthProvider>
      <SessionTimeout>
        <App />
      </SessionTimeout>
    </AuthProvider>
  </React.StrictMode>,
);
