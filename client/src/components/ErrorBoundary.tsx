import { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, Copy, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  errorId: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: this.generateErrorId(),
    };
  }

  private generateErrorId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 9);
    return `CLIENT-${timestamp}-${random}`.toUpperCase();
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleCopyError = () => {
    const { error, errorInfo, errorId } = this.state;
    const errorDetails = JSON.stringify(
      {
        errorId,
        timestamp: new Date().toISOString(),
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
      null,
      2
    );

    navigator.clipboard.writeText(errorDetails);
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
          <Card className="w-full max-w-2xl border-red-200 dark:border-red-900 shadow-xl">
            <CardHeader className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-100 dark:bg-red-950 rounded-full">
                  <AlertCircle className="w-8 h-8 text-red-600 dark:text-red-400" />
                </div>
                <div className="flex-1">
                  <CardTitle className="text-2xl text-red-900 dark:text-red-100">
                    Something Went Wrong
                  </CardTitle>
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                    We're sorry for the inconvenience. The error has been logged.
                  </p>
                </div>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-6">
              {/* Error ID Display */}
              <div className="bg-slate-100 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Error ID
                  </span>
                  <ErrorCopyButton 
                    errorId={this.state.errorId}
                    error={this.state.error}
                    errorInfo={this.state.errorInfo}
                  />
                </div>
                <code className="text-lg font-mono text-purple-600 dark:text-purple-400 block">
                  {this.state.errorId}
                </code>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                  Include this ID when contacting support
                </p>
              </div>

              {/* Error Message (for development) */}
              {process.env.NODE_ENV === 'development' && this.state.error && (
                <details className="bg-slate-100 dark:bg-slate-900 rounded-lg p-4 border border-slate-200 dark:border-slate-800">
                  <summary className="text-sm font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                    Technical Details (Development Only)
                  </summary>
                  <div className="mt-3 space-y-2">
                    <div>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Error:</span>
                      <pre className="text-xs bg-slate-200 dark:bg-slate-800 p-2 rounded mt-1 overflow-auto">
                        {this.state.error.message}
                      </pre>
                    </div>
                    {this.state.error.stack && (
                      <div>
                        <span className="text-xs text-slate-500 dark:text-slate-400">Stack:</span>
                        <pre className="text-xs bg-slate-200 dark:bg-slate-800 p-2 rounded mt-1 overflow-auto max-h-40">
                          {this.state.error.stack}
                        </pre>
                      </div>
                    )}
                  </div>
                </details>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <Button
                  onClick={this.handleReload}
                  className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700"
                  data-testid="button-reload-page"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </Button>
                <Button
                  onClick={() => window.location.href = '/'}
                  variant="outline"
                  className="flex-1"
                  data-testid="button-go-home"
                >
                  Go to Home
                </Button>
              </div>

              <p className="text-xs text-center text-slate-500 dark:text-slate-400">
                If this problem persists, please contact support at support@clasio.ai
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

// Separate component to use hooks
function ErrorCopyButton({ errorId, error, errorInfo }: { errorId: string; error: Error | null; errorInfo: ErrorInfo | null }) {
  const { toast } = useToast();

  const handleCopy = () => {
    const errorDetails = JSON.stringify(
      {
        errorId,
        timestamp: new Date().toISOString(),
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
        userAgent: navigator.userAgent,
        url: window.location.href,
      },
      null,
      2
    );

    navigator.clipboard.writeText(errorDetails);
    toast({
      title: 'Copied to clipboard',
      description: 'Error details have been copied. You can share this with support.',
    });
  };

  return (
    <Button
      onClick={handleCopy}
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      data-testid="button-copy-error"
    >
      <Copy className="w-3 h-3 mr-1" />
      Copy Details
    </Button>
  );
}
