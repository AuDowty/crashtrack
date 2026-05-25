import { Component, type ReactNode } from "react";
import { ErrorPage } from "@/pages/ErrorPage";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error("react_error_boundary", error, info);
  }

  render() {
    if (this.state.error) {
      return <ErrorPage status={500} message={this.state.error.message} />;
    }
    return this.props.children;
  }
}
