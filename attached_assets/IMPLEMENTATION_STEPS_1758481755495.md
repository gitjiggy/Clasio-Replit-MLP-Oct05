# Implementation Steps for Replit

Copy and paste these commands/code snippets into Replit to implement the enterprise recommendations:

## Phase 1: Database Schema Updates

### 1. Install new dependencies
```bash
npm install bull ioredis @types/bull helmet crypto-js
```

### 2. Create the organization schema file
Copy the entire `organizationSchema.ts` content from the main guide into:
`shared/organizationSchema.ts`

### 3. Run the database migration
Copy the SQL migration content from the guide into:
`server/migrations/0007_add_enterprise_tables.sql`

Then run:
```bash
npm run migrate
```

## Phase 2: Background Job System

### 4. Create job queue service
Copy the `jobQueue.ts` content into:
`server/services/jobQueue.ts`

### 5. Create job processors
Copy the `jobProcessors.ts` content into:
`server/workers/jobProcessors.ts`

### 6. Add Redis configuration to .env
```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password
SESSION_SECRET=your_very_long_random_session_secret_here
ENCRYPTION_KEY=your_32_character_encryption_key_here
JWT_SECRET=your_jwt_secret_here
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
CSP_REPORT_URI=https://your-domain.com/csp-report
SENTRY_DSN=your_sentry_dsn_here
LOG_LEVEL=info
DB_POOL_MIN=2
DB_POOL_MAX=10
```

## Phase 3: Authorization System

### 7. Create authorization middleware
Copy the `authorization.ts` content into:
`server/middleware/authorization.ts`

### 8. Create security middleware
Copy the `security.ts` content into:
`server/middleware/security.ts`

## Phase 4: Frontend Updates

### 9. Create organization context
Copy the `OrganizationContext.tsx` content into:
`client/src/contexts/OrganizationContext.tsx`

### 10. Update main App.tsx
Wrap your app with the new OrganizationProvider:

```tsx
import { OrganizationProvider } from './contexts/OrganizationContext';

// In your App component:
<AuthProvider>
  <OrganizationProvider>
    {/* Your existing app content */}
  </OrganizationProvider>
</AuthProvider>
```

## Phase 5: Update Routes

### 11. Update server routes
Apply the middleware updates shown in the guide to your `server/routes.ts` file.

Key changes:
- Add middleware imports
- Apply global middleware
- Add authorization to existing routes
- Add new bulk upload and job management endpoints

## Testing Commands

After implementation, test with:

```bash
# Run tests
npm test

# Check TypeScript
npm run typecheck

# Check linting
npm run lint

# Start development server
npm run dev
```

## Verification Checklist

- [ ] Database migration completed successfully
- [ ] New tables created (organizations, user_roles, audit_logs, background_jobs, data_classifications)
- [ ] Redis connection working for job queue
- [ ] Authorization middleware protecting routes
- [ ] Audit logging capturing user actions
- [ ] Multi-tenant isolation working
- [ ] Security headers applied
- [ ] Job queue processing background tasks
- [ ] Frontend organization context loading

## Deployment Notes

For production deployment, ensure:

1. Redis instance is properly configured and secured
2. Environment variables are set correctly
3. Database migrations are run
4. Security headers are properly configured
5. Rate limiting is appropriate for your traffic
6. Monitoring and logging are set up
7. CSP policies are tested with your domain

This implementation transforms Clasio into an enterprise-ready multi-tenant document management system with proper security, authorization, audit logging, and background job processing.