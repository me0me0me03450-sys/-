import { useCallback, useEffect, useState } from 'react';
import { apiClient, setUnauthorizedHandler } from './services/apiClient';
import { AppRoute, StaffAccount } from './types/nidaa';
import { InternalHubView } from './views/InternalHubView';
import { ParentPortalView } from './views/ParentPortalView';
import { QueueMonitorView } from './views/QueueMonitorView';
import { SystemAdminView } from './views/SystemAdminView';

function resolveRouteFromLocation(): AppRoute {
  const path = window.location.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const hash = window.location.hash.toLowerCase();
  const target = hash.startsWith('#/') ? hash.slice(1) : path;

  if (target.startsWith('/staff/queue')) {
    return 'staff_queue';
  }
  if (target === '/staff/admin') {
    return 'staff_admin';
  }
  if (target === '/staff' || target === '/internal') {
    return 'staff_hub';
  }
  return 'parent';
}

function getPathForRoute(route: AppRoute): string {
  switch (route) {
    case 'parent':
      return '/';
    case 'staff_hub':
      return '/staff';
    case 'staff_queue':
      return '/staff/queue';
    case 'staff_admin':
      return '/staff/admin';
  }
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => resolveRouteFromLocation());
  const [currentUser, setCurrentUser] = useState<StaffAccount | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(resolveRouteFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, []);

  const navigate = useCallback((targetRoute: AppRoute) => {
    const nextPath = getPathForRoute(targetRoute);
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setRoute(targetRoute);
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  const handleLogout = useCallback(() => {
    apiClient.logout();
    setCurrentUser(null);
    navigate('staff_hub');
  }, [navigate]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCurrentUser(null);
      navigate('staff_hub');
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  if (route === 'parent') {
    return <ParentPortalView />;
  }

  // All internal routes require authenticated staff user in memory
  if (!currentUser) {
    return (
      <InternalHubView
        currentUser={null}
        onAuthenticated={(user) => {
          setCurrentUser(user);
          if (user.role === 'queue_monitor' && route === 'staff_admin') {
            navigate('staff_queue');
          }
        }}
        onLogout={handleLogout}
        onNavigate={navigate}
      />
    );
  }

  if (route === 'staff_queue') {
    return (
      <QueueMonitorView currentUser={currentUser} onNavigate={navigate} />
    );
  }

  if (route === 'staff_admin') {
    if (currentUser.role !== 'super_admin') {
      return (
        <InternalHubView
          currentUser={currentUser}
          onAuthenticated={setCurrentUser}
          onLogout={handleLogout}
          onNavigate={navigate}
        />
      );
    }
    return (
      <SystemAdminView currentUser={currentUser} onNavigate={navigate} />
    );
  }

  return (
    <InternalHubView
      currentUser={currentUser}
      onAuthenticated={setCurrentUser}
      onLogout={handleLogout}
      onNavigate={navigate}
    />
  );
}
