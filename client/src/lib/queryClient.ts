import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { auth } from "./firebase";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text} (${res.url})`);
  }
}

async function getAuthHeaders(): Promise<{ [key: string]: string }> {
  const headers: { [key: string]: string } = {};
  
  if (auth.currentUser) {
    try {
      // Force refresh if token is near expiry to prevent failures
      const token = await auth.currentUser.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    } catch (error) {
      console.error('Failed to get Firebase ID token:', error);
      // Try to force refresh once
      try {
        const freshToken = await auth.currentUser.getIdToken(true);
        headers['Authorization'] = `Bearer ${freshToken}`;
      } catch (refreshError) {
        console.error('Failed to refresh Firebase ID token:', refreshError);
        throw new Error('Authentication failed. Please refresh the page and sign in again.');
      }
    }
  } else {
    console.warn('No Firebase user authenticated - request will be sent without auth header');
  }
  
  return headers;
}

// Overload 1: New pattern (url, options) returning parsed JSON
export async function apiRequest<T = any>(
  url: string,
  options: RequestInit & { headers?: Record<string, string> }
): Promise<T>;

// Overload 2: Legacy pattern (method, url, data) returning Response
export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response>;

// Implementation
export async function apiRequest<T = any>(
  urlOrMethod: string,
  urlOrOptions?: string | (RequestInit & { headers?: Record<string, string> }),
  data?: unknown | undefined,
): Promise<T | Response> {
  const authHeaders = await getAuthHeaders();
  
  // New pattern: apiRequest(url, options)
  if (typeof urlOrOptions === 'object') {
    const url = urlOrMethod;
    const options = urlOrOptions;
    
    const headers = {
      ...authHeaders,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    };

    const res = await fetch(url, {
      ...options,
      headers,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return await res.json() as T;
  }
  
  // Legacy pattern: apiRequest(method, url, data)
  else {
    const method = urlOrMethod;
    const url = urlOrOptions as string;
    
    const headers = {
      ...authHeaders,
      ...(data ? { "Content-Type": "application/json" } : {}),
    };

    const res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

    await throwIfResNotOk(res);
    return res;
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    let url = queryKey[0] as string;
    
    // Handle query parameters if they exist
    if (queryKey.length > 1 && queryKey[1] && typeof queryKey[1] === 'object') {
      const params = new URLSearchParams();
      const queryParams = queryKey[1] as Record<string, any>;
      
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== '') {
          params.append(key, String(value));
        }
      }
      
      if (params.toString()) {
        url += '?' + params.toString();
      }
    }

    const authHeaders = await getAuthHeaders();
    const res = await fetch(url, {
      headers: authHeaders,
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
