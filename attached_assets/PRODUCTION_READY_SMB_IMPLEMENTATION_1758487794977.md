# Production-Ready SMB Implementation for Clasio

Based on the pragmatic "enterprise-ready" definition: Security baseline, reliability, cost guardrails, light governance, and supportability.

## Must-Do Before Public Beta (1-2 weeks focused work)

### Phase 1: Auth & Tenancy (Simple but Safe) 🚨

#### 1. Enhanced Organization Schema
```sql
-- Organizations with usage tracking and limits
CREATE TABLE "organizations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "owner_id" text NOT NULL,
  "plan" text NOT NULL DEFAULT 'free',
  "created_at" timestamp DEFAULT now() NOT NULL,

  -- Usage tracking
  "document_count" integer DEFAULT 0,
  "storage_used_mb" integer DEFAULT 0,
  "ai_analyses_this_month" integer DEFAULT 0,

  -- Quotas per plan
  "max_documents" integer DEFAULT 500,
  "max_storage_mb" integer DEFAULT 1000,
  "max_ai_analyses_per_month" integer DEFAULT 100,

  -- Billing
  "stripe_customer_id" text,
  "subscription_status" text DEFAULT 'active'
);

-- Organization members (Owner/Member only)
CREATE TABLE "organization_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "role" text NOT NULL CHECK (role IN ('owner', 'member')),
  "invited_by" text,
  "joined_at" timestamp DEFAULT now() NOT NULL,
  "is_active" boolean DEFAULT true,
  UNIQUE(organization_id, user_id)
);

-- Light audit history (90 days)
CREATE TABLE "activity_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text,
  "action" text NOT NULL,
  "resource_type" text NOT NULL,
  "resource_id" text,
  "resource_name" text,
  "details" jsonb,
  "timestamp" timestamp DEFAULT now() NOT NULL
);

-- Document sharing (per-document invite by email)
CREATE TABLE "document_shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE CASCADE,
  "shared_by" text NOT NULL,
  "shared_with_email" text,
  "share_token" text UNIQUE, -- for expiring links
  "access_level" text DEFAULT 'viewer',
  "expires_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

-- Update documents table
ALTER TABLE "documents"
ADD COLUMN "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
ADD COLUMN "soft_deleted_at" timestamp,
ADD COLUMN "last_accessed_at" timestamp;
```

#### 2. Data-Access Layer with Forced Scoping
```typescript
// server/db/scopedQueries.ts
import { db } from './connection';
import { documents, organizations } from '../../shared/schema';
import { eq, and, isNull } from 'drizzle-orm';

// Every query helper requires orgId, userId - NO unscoped queries allowed
export class ScopedDB {
  // Forbid direct db access in routes
  static forbidUnscoped() {
    // CI check: grep for "db.query" in routes should fail
  }

  static async getDocuments(orgId: string, userId: string) {
    return db.query.documents.findMany({
      where: and(
        eq(documents.organizationId, orgId),
        isNull(documents.softDeletedAt) // Respect soft deletes
      ),
    });
  }

  static async getDocument(orgId: string, userId: string, documentId: string) {
    return db.query.documents.findFirst({
      where: and(
        eq(documents.id, documentId),
        eq(documents.organizationId, orgId),
        isNull(documents.softDeletedAt)
      ),
    });
  }

  static async createDocument(orgId: string, userId: string, data: any) {
    // Check quotas first
    const org = await this.getOrganization(orgId);
    if (org.documentCount >= org.maxDocuments) {
      throw new Error('Document limit reached for your plan');
    }

    const doc = await db.insert(documents).values({
      ...data,
      organizationId: orgId,
      uploadedBy: userId,
    }).returning();

    // Update usage counters
    await this.incrementUsage(orgId, 'document_count', 1);
    await this.incrementUsage(orgId, 'storage_used_mb', Math.ceil(data.fileSize / 1024 / 1024));

    return doc[0];
  }

  static async softDeleteDocument(orgId: string, userId: string, documentId: string) {
    return db.update(documents)
      .set({ softDeletedAt: new Date() })
      .where(and(
        eq(documents.id, documentId),
        eq(documents.organizationId, orgId)
      ));
  }

  static async getOrganization(orgId: string) {
    return db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
    });
  }

  static async incrementUsage(orgId: string, field: string, amount: number) {
    await db.execute(sql`
      UPDATE organizations
      SET ${sql.identifier(field)} = ${sql.identifier(field)} + ${amount}
      WHERE id = ${orgId}
    `);
  }
}
```

#### 3. Per-Document Sharing
```typescript
// server/routes/sharing.ts
export async function shareDocument(req: OrgRequest, res: Response) {
  const { documentId } = req.params;
  const { email, accessLevel = 'viewer', expiresInDays = 30 } = req.body;

  // Verify user owns document
  const doc = await ScopedDB.getDocument(req.organizationId!, req.user.uid, documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  const shareToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  await db.insert(documentShares).values({
    documentId,
    sharedBy: req.user.uid,
    sharedWithEmail: email,
    shareToken,
    accessLevel,
    expiresAt,
  });

  // Send email invitation (implement email service)
  // await sendShareInvitation(email, doc.name, shareToken);

  await logActivity(req.organizationId!, req.user.uid, 'SHARED_DOCUMENT', doc.name);

  res.json({
    success: true,
    shareUrl: `${process.env.BASE_URL}/shared/${shareToken}`
  });
}
```

### Phase 2: Background Jobs & Idempotency 🚨

#### 4. Job Queue with Idempotency
```typescript
// server/services/jobQueue.ts
import Bull from 'bull';

interface JobOptions {
  priority?: number;
  delay?: number;
  idempotencyKey: string; // REQUIRED
  organizationId: string;
  userId: string;
}

export class JobQueue {
  private queue = new Bull('ai-analysis', {
    redis: process.env.REDIS_URL,
    defaultJobOptions: {
      removeOnComplete: 10,
      removeOnFail: 5,
      attempts: 3,
      backoff: 'exponential',
    },
  });

  async addAIAnalysisJob(documentId: string, options: JobOptions) {
    // Check AI quota first
    const org = await ScopedDB.getOrganization(options.organizationId);
    if (org.aiAnalysesThisMonth >= org.maxAiAnalysesPerMonth) {
      throw new Error('AI analysis limit reached this month');
    }

    // Idempotency: check if job already exists
    const existingJob = await this.queue.getJob(options.idempotencyKey);
    if (existingJob) {
      return existingJob.id;
    }

    return this.queue.add('analyze-document', {
      documentId,
      organizationId: options.organizationId,
      userId: options.userId,
    }, {
      jobId: options.idempotencyKey,
      priority: options.priority || 5,
      delay: options.delay || 0,
    });
  }

  // Acceptance test: kill API mid-analysis; job resumes and finishes exactly once
  async processAnalysis(job: Bull.Job) {
    const { documentId, organizationId, userId } = job.data;

    try {
      // Set job as started
      await job.progress(10);

      const doc = await ScopedDB.getDocument(organizationId, userId, documentId);
      if (!doc) throw new Error('Document not found');

      await job.progress(30);

      // AI analysis (with cost tracking)
      const analysis = await analyzeWithGemini(doc);

      await job.progress(80);

      // Update document
      await db.update(documents)
        .set({
          category: analysis.category,
          documentType: analysis.documentType,
          summary: analysis.summary,
          aiAnalysisAt: new Date(),
        })
        .where(eq(documents.id, documentId));

      // Increment AI usage counter
      await ScopedDB.incrementUsage(organizationId, 'ai_analyses_this_month', 1);

      await job.progress(100);

      await logActivity(organizationId, userId, 'AI_ANALYSIS_COMPLETED', doc.name);

    } catch (error) {
      await logActivity(organizationId, userId, 'AI_ANALYSIS_FAILED', doc.name, { error: error.message });
      throw error;
    }
  }
}
```

### Phase 3: Observability Minimal Set 🚨

#### 5. Sentry + Structured Logs
```typescript
// server/middleware/observability.ts
import * as Sentry from '@sentry/node';
import { randomUUID } from 'crypto';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
});

export function addRequestId(req: Request, res: Response, next: NextFunction) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

export function structuredLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    console.log(JSON.stringify({
      reqId: req.requestId,
      orgId: req.organizationId,
      route: req.route?.path || req.path,
      method: req.method,
      status: res.statusCode,
      duration,
      timestamp: new Date().toISOString(),
    }));

    // Track metrics
    if (req.path.includes('/api/documents/upload')) {
      // Track upload→searchable time
      metrics.timing('upload_to_searchable', duration);
    }
  });

  next();
}

// 5 key metrics
const metrics = {
  timing: (metric: string, value: number) => {
    // Send to your metrics service (DataDog, CloudWatch, etc.)
  },
  increment: (metric: string) => {
    // Track error rates, job success %, etc.
  }
};

// One critical alert: "Upload→Searchable P95 > 2 min for 10 min"
export function alertOnSlowUploads() {
  // Implement alerting logic
}
```

#### 6. Rate Limits & Quotas
```typescript
// server/middleware/rateLimits.ts
import rateLimit from 'express-rate-limit';

// Per-org coarse limits
export const orgLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: async (req) => {
    const org = await ScopedDB.getOrganization(req.organizationId);
    return org.plan === 'pro' ? 1000 : 100; // requests per hour
  },
  keyGenerator: (req) => req.organizationId,
  message: { error: 'Rate limit exceeded for organization' },
});

// AI analysis limits
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 analyses/hour
  keyGenerator: (req) => req.organizationId,
  message: { error: 'AI analysis limit reached. Upgrade for more.' },
});

// File size validation
export function validateFileSize(req: Request, res: Response, next: NextFunction) {
  const maxSize = 50 * 1024 * 1024; // 50MB max/file
  if (req.headers['content-length'] && parseInt(req.headers['content-length']) > maxSize) {
    return res.status(413).json({ error: 'File too large (50MB max)' });
  }
  next();
}
```

### Phase 4: Security & Data Lifecycle 🚨

#### 7. Security Headers & Safe File Handling
```typescript
// server/middleware/security.ts
import helmet from 'helmet';

export const securityMiddleware = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'", "https://api.openai.com"],
      },
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
  }),

  (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  },
];

// Safe file handling - no raw render of untrusted files
export function safeFileViewer(req: Request, res: Response) {
  // Use PDF.js viewer or similar safe renderer
  // Never directly serve user PDFs as text/html
  const { documentId } = req.params;

  res.render('document-viewer', {
    documentId,
    viewerUrl: `/api/documents/${documentId}/safe-view`,
  });
}

// Virus scanning (integrate ClamAV or external API)
export async function scanFile(buffer: Buffer): Promise<boolean> {
  // Implement virus scanning
  // Return false if malicious
  return true;
}
```

#### 8. Data Lifecycle & User Data Controls
```typescript
// server/routes/dataLifecycle.ts

// Soft delete → hard purge (30 days)
export async function schedulePurgeJob() {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const docsToDelete = await db.query.documents.findMany({
    where: and(
      isNotNull(documents.softDeletedAt),
      lt(documents.softDeletedAt, cutoff)
    ),
  });

  for (const doc of docsToDelete) {
    // Delete from storage
    await deleteFromGoogleDrive(doc.driveFileId);
    // Delete from database
    await db.delete(documents).where(eq(documents.id, doc.id));
  }
}

// Delete my account
export async function deleteUserAccount(req: OrgRequest, res: Response) {
  const { userId, organizationId } = req;

  // Revoke Drive tokens
  await revokeGoogleTokens(userId);

  // Delete stored copies/metadata
  await db.delete(documents).where(eq(documents.uploadedBy, userId));

  // Remove from organization
  await db.delete(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.organizationId, organizationId)
  ));

  // Log for compliance
  await logActivity(organizationId, userId, 'ACCOUNT_DELETED', 'user');

  res.json({ success: true });
}

// Export my data
export async function exportUserData(req: OrgRequest, res: Response) {
  const { userId, organizationId } = req;

  const docs = await ScopedDB.getDocuments(organizationId, userId);
  const activities = await db.query.activityLog.findMany({
    where: and(
      eq(activityLog.userId, userId),
      eq(activityLog.organizationId, organizationId)
    ),
  });

  const exportData = {
    documents: docs,
    activities,
    exportedAt: new Date().toISOString(),
  };

  // Create ZIP with JSON manifest
  const zip = await createZipExport(exportData);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="my-data.zip"');
  res.send(zip);
}
```

### Phase 5: Billing & Drive Sync 🚨

#### 9. Stripe Integration with Usage Gates
```typescript
// server/routes/billing.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createCheckoutSession(req: OrgRequest, res: Response) {
  const { priceId } = req.body;

  const session = await stripe.checkout.sessions.create({
    customer: req.organization.stripeCustomerId,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.BASE_URL}/billing/success`,
    cancel_url: `${process.env.BASE_URL}/billing/cancel`,
  });

  res.json({ url: session.url });
}

// Usage metering for AI analyses
export async function reportUsage(organizationId: string, metric: string, quantity: number) {
  const org = await ScopedDB.getOrganization(organizationId);

  if (org.stripeCustomerId) {
    await stripe.subscriptionItems.createUsageRecord(
      org.subscriptionItemId,
      { quantity, action: 'increment' }
    );
  }
}

// Block at limit with upgrade prompt
export function checkQuotas(req: OrgRequest, res: Response, next: NextFunction) {
  const org = req.organization;

  if (req.path.includes('/upload') && org.documentCount >= org.maxDocuments) {
    return res.status(402).json({
      error: 'Document limit reached',
      upgradeUrl: '/billing/upgrade',
      currentPlan: org.plan,
    });
  }

  if (req.path.includes('/ai-analysis') && org.aiAnalysesThisMonth >= org.maxAiAnalysesPerMonth) {
    return res.status(402).json({
      error: 'AI analysis limit reached this month',
      upgradeUrl: '/billing/upgrade',
      currentUsage: org.aiAnalysesThisMonth,
      limit: org.maxAiAnalysesPerMonth,
    });
  }

  next();
}
```

#### 10. Right-Sized Drive Sync
```typescript
// server/services/driveSync.ts

// Implement Changes API with delta tokens (not polling every file)
export class DriveSync {
  async syncChanges(organizationId: string, userId: string) {
    const tokens = await getStoredTokens(userId);
    const savedPageToken = await getStoredPageToken(userId);

    try {
      const changes = await drive.changes.list({
        auth: oauth2Client,
        pageToken: savedPageToken || 'latest',
        includeRemoved: true,
      });

      for (const change of changes.data.changes) {
        await this.processChange(organizationId, userId, change);
      }

      // Store new page token
      await storePageToken(userId, changes.data.nextPageToken);

    } catch (error) {
      console.error('Drive sync failed:', error);
      // Don't break the app - sync will retry
    }
  }

  async processChange(orgId: string, userId: string, change: any) {
    if (change.removed) {
      // File deleted in Drive
      await ScopedDB.softDeleteDocument(orgId, userId, change.fileId);
    } else {
      // File added/modified - conflict strategy: last-writer-wins
      const existingDoc = await db.query.documents.findFirst({
        where: eq(documents.driveFileId, change.fileId),
      });

      if (existingDoc && existingDoc.updatedAt < change.time) {
        // Drive version is newer - update local copy
        await this.updateFromDrive(orgId, userId, change.file);
      }
    }
  }
}

// Schedule sync every 15 minutes (not real-time polling)
setInterval(() => {
  syncAllOrganizations();
}, 15 * 60 * 1000);
```

---

## Production Readiness Checklist

### Security & Privacy Baseline ✅
- [ ] All routes scoped to orgId + userId
- [ ] Security headers (CSP, HSTS, etc.)
- [ ] File virus scanning
- [ ] Input validation and sanitization

### Reliability & Recoverability ✅
- [ ] Background jobs with retry/backoff
- [ ] Idempotency keys prevent duplicate work
- [ ] Soft deletes with 30-day recovery
- [ ] Daily backups + weekly restore drill

### Cost Guardrails ✅
- [ ] Per-org quotas (documents, storage, AI analyses)
- [ ] AI token budget with stop-at-limit
- [ ] Usage metering integrated with billing

### Light Governance ✅
- [ ] Activity log (90 days): upload, share, delete, classify
- [ ] Per-document sharing with expiring links
- [ ] Owner/Member roles only

### Supportability ✅
- [ ] Structured logs with reqId, orgId, duration
- [ ] Sentry error tracking
- [ ] 5 key metrics tracked
- [ ] One critical alert configured

---

## Enhanced Data Lifecycle & Input Validation

### Input Validation & Security Polish

```typescript
// server/middleware/validation.ts
import { z } from 'zod';

// Zod schemas for all write paths
export const CreateDocumentSchema = z.object({
  name: z.string().min(1).max(255),
  category: z.string().optional(),
  organizationId: z.string().uuid(),
});

export const ShareDocumentSchema = z.object({
  email: z.string().email(),
  accessLevel: z.enum(['viewer', 'editor']).default('viewer'),
  expiresInDays: z.number().min(1).max(90).default(30),
});

// Validation middleware factory
export function validateBody<T>(schema: z.ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
      }
      next(error);
    }
  };
}

// Apply to routes
app.post('/api/documents',
  validateBody(CreateDocumentSchema),
  requireOrganizationAccess,
  async (req, res) => {
    // req.body is now validated and typed
  }
);
```

### Enhanced Data Export & Deletion

```typescript
// Enhanced data export with all AI artifacts
export async function exportUserData(req: OrgRequest, res: Response) {
  const { userId, organizationId } = req;

  const docs = await ScopedDB.getDocuments(organizationId, userId);
  const activities = await db.query.activityLog.findMany({
    where: and(
      eq(activityLog.userId, userId),
      eq(activityLog.organizationId, organizationId)
    ),
  });

  // Include AI analysis cache entries
  const contentHashes = docs.map(d => d.contentHash).filter(Boolean);
  const aiCache = await db.query.contentCache.findMany({
    where: inArray(contentCache.contentHash, contentHashes),
  });

  const exportData = {
    documents: docs,
    activities,
    aiAnalysisCache: aiCache,
    embeddings: [], // Include vector embeddings if you have them
    exportedAt: new Date().toISOString(),
  };

  // Create ZIP with JSON manifest
  const zip = await createZipExport(exportData);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="my-data.zip"');
  res.send(zip);
}

// Enhanced account deletion with AI artifact cleanup
export async function deleteUserAccount(req: OrgRequest, res: Response) {
  const { userId, organizationId } = req;

  // Get all user documents first
  const userDocs = await ScopedDB.getDocuments(organizationId, userId);
  const contentHashes = userDocs.map(d => d.contentHash).filter(Boolean);

  // Revoke Drive tokens
  await revokeGoogleTokens(userId);

  // Delete stored copies/metadata
  await db.delete(documents).where(eq(documents.uploadedBy, userId));

  // Clean up AI analysis cache (if no other docs use the same hash)
  for (const hash of contentHashes) {
    const otherDocs = await db.query.documents.findFirst({
      where: and(
        eq(documents.contentHash, hash),
        ne(documents.uploadedBy, userId)
      ),
    });

    if (!otherDocs) {
      await db.delete(contentCache).where(eq(contentCache.contentHash, hash));
    }
  }

  // Delete embeddings/summaries if you have separate tables
  // await db.delete(documentEmbeddings).where(eq(documentEmbeddings.createdBy, userId));

  // Remove from organization
  await db.delete(organizationMembers).where(and(
    eq(organizationMembers.userId, userId),
    eq(organizationMembers.organizationId, organizationId)
  ));

  // Log for compliance
  await logActivity(organizationId, userId, 'ACCOUNT_DELETED', 'user');

  res.json({ success: true });
}
```

---

## Production Readiness Checklist

### Supportability ✅
- [ ] Real logger (pino) shipping to Better Stack/Grafana Cloud
- [ ] Sentry error tracking
- [ ] 5 key metrics: route p95, error rate, queue depth, job success %, drive sync lag
- [ ] Two critical alerts: upload→searchable P95 > 2min, sync lag > 30min
- [ ] Product analytics funnel tracking

### Input Validation & Polish ✅
- [ ] Zod validation on every write path
- [ ] Filename sanitization (no CR/LF, control chars)
- [ ] Content-Disposition: attachment for downloads
- [ ] frame-ancestors 'none' in CSP
- [ ] Quarantine files until virus scan completes

### Enhanced Features ✅
- [ ] BullMQ with explicit concurrency and poison queue
- [ ] DB-persisted idempotency (safe across queue resets)
- [ ] Content-hash caching for AI deduplication
- [ ] Fast vs Thorough analysis modes with separate metering
- [ ] Drive sync with startPageToken and proper conflict handling
- [ ] Stripe webhooks with 24h grace periods
- [ ] Soft-delete partial indexes for performance

This implementation gives you production-ready SMB software in 1-2 weeks, not months. Each feature is pragmatic, addresses real production issues, and focuses on user needs over enterprise theater.