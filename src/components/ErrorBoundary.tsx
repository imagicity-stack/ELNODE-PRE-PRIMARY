import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw, Home } from 'lucide-react';
import { Capacitor } from '@capacitor/core';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleRefresh = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white rounded-[2rem] shadow-2xl p-10 text-center border border-gray-100">
            <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center text-amber-600 mx-auto mb-8 animate-pulse">
              <AlertTriangle className="w-10 h-10" />
            </div>
            
            <h1 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">Something went wrong</h1>
            <p className="text-gray-500 mb-10 leading-relaxed font-medium">
              An unexpected error occurred. Don't worry, your data is safe. Try refreshing the page or going back to home.
            </p>

            <div className="space-y-4">
              <button
                onClick={this.handleRefresh}
                className="w-full h-14 bg-blue-600 text-white rounded-2xl font-black text-lg shadow-xl shadow-blue-600/20 hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                <RefreshCcw className="w-5 h-5" />
                Refresh Page
              </button>
              
              <button
                onClick={this.handleGoHome}
                className="w-full h-14 bg-gray-100 text-gray-700 rounded-2xl font-black text-lg hover:bg-gray-200 active:scale-95 transition-all flex items-center justify-center gap-3"
              >
                <Home className="w-5 h-5" />
                Back to Home
              </button>
            </div>

            {(process.env.NODE_ENV === 'development' || Capacitor.isNativePlatform()) && (
              <div className="mt-8 pt-8 border-t border-gray-50">
                <p className="text-left text-xs font-mono text-red-500 bg-red-50 p-4 rounded-xl overflow-auto max-h-40">
                  {this.state.error?.message}{'\n\n'}{this.state.error?.stack}
                </p>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
