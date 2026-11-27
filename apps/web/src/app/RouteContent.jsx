import { Component, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

class RouteErrorBoundary extends Component {
  state = { failed: false, route: this.props.route };

  static getDerivedStateFromProps({ route }, state) {
    return route !== state.route ? { route, failed: false } : null;
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="mx-auto max-w-lg space-y-3 px-6 py-12 text-center">
        <p role="alert" className="font-semibold">{this.props.unavailableMessage}</p>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button type="button" onClick={() => window.location.reload()}>Reload page</Button>
      </section>
    );
  }
}

const pageLoading = <p role="status" className="px-6 py-12 text-center text-sm text-muted-foreground">Loading page…</p>;

export default function RouteContent({ children, loading = pageLoading, unavailableMessage = 'This page could not load.' }) {
  const { pathname } = useLocation();
  return (
    <RouteErrorBoundary route={pathname} unavailableMessage={unavailableMessage}>
      <Suspense fallback={loading}>
        {children}
      </Suspense>
    </RouteErrorBoundary>
  );
}
