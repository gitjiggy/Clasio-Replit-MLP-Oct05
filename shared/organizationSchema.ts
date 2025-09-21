import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, varchar, index, unique } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Simplified Organizations with usage tracking and limits
export const organizations = pgTable('organizations', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  ownerId: text('owner_id').notNull(), // Firebase UID
  plan: text('plan').notNull().default('free'), // free, pro
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),

  // Usage tracking - critical for SMB cost control
  documentCount: integer('document_count').default(0),
  storageUsedMb: integer('storage_used_mb').default(0),
  aiAnalysesThisMonth: integer('ai_analyses_this_month').default(0),

  // Quotas per plan - enforced in application logic
  maxDocuments: integer('max_documents').default(500), // Free plan limit
  maxStorageMb: integer('max_storage_mb').default(1000), // 1GB free
  maxAiAnalysesPerMonth: integer('max_ai_analyses_per_month').default(100),

  // Billing - simple Stripe integration
  stripeCustomerId: text('stripe_customer_id'),
  subscriptionStatus: text('subscription_status').default('active'),
});

// Simple organization members - Owner/Member only (no complex RBAC)
export const organizationMembers = pgTable('organization_members', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(), // Firebase UID
  role: text('role').notNull().default('member'), // 'owner' or 'member' only
  invitedBy: text('invited_by'),
  joinedAt: timestamp('joined_at').default(sql`now()`).notNull(),
  isActive: boolean('is_active').default(true),
}, (table) => ({
  // Ensure one user per org
  uniqueUserOrg: unique('organization_members_user_org_unique').on(table.organizationId, table.userId),
}));

// Light audit history (90 days retention) - compliance minimum
export const activityLog = pgTable('activity_log', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  action: text('action').notNull(), // CREATED, DELETED, SHARED, etc.
  resourceType: text('resource_type').notNull(), // document, folder, etc.
  resourceId: text('resource_id'),
  resourceName: text('resource_name'),
  details: text('details'), // JSON string with extra info
  timestamp: timestamp('timestamp').default(sql`now()`).notNull(),
}, (table) => ({
  orgTimeIdx: index('activity_log_org_time_idx').on(table.organizationId, table.timestamp),
}));

// Document sharing (per-document invite by email)
export const documentShares = pgTable('document_shares', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar('document_id').notNull(),
  sharedBy: text('shared_by').notNull(), // Firebase UID
  sharedWithEmail: text('shared_with_email'),
  shareToken: text('share_token').unique(), // for expiring links
  accessLevel: text('access_level').default('viewer'), // viewer, editor
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
}, (table) => ({
  shareTokenIdx: index('document_shares_token_idx').on(table.shareToken),
  documentIdx: index('document_shares_document_idx').on(table.documentId),
}));

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  activityLog: many(activityLog),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
}));

export const activityLogRelations = relations(activityLog, ({ one }) => ({
  organization: one(organizations, {
    fields: [activityLog.organizationId],
    references: [organizations.id],
  }),
}));

// Zod schemas for validation
export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  documentCount: true,
  storageUsedMb: true,
  aiAnalysesThisMonth: true,
});

export const insertOrganizationMemberSchema = createInsertSchema(organizationMembers).omit({
  id: true,
  joinedAt: true,
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({
  id: true,
  timestamp: true,
});

export const insertDocumentShareSchema = createInsertSchema(documentShares).omit({
  id: true,
  createdAt: true,
});

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = z.infer<typeof insertOrganizationSchema>;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = z.infer<typeof insertOrganizationMemberSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;
export type NewActivityLog = z.infer<typeof insertActivityLogSchema>;
export type DocumentShare = typeof documentShares.$inferSelect;
export type NewDocumentShare = z.infer<typeof insertDocumentShareSchema>;

// Simple role constants for SMBs
export const ROLES = {
  OWNER: 'owner',
  MEMBER: 'member',
} as const;

// Plan limits
export const PLAN_LIMITS = {
  free: {
    maxDocuments: 500,
    maxStorageMb: 1000, // 1GB
    maxAiAnalysesPerMonth: 100,
  },
  pro: {
    maxDocuments: 10000,
    maxStorageMb: 50000, // 50GB
    maxAiAnalysesPerMonth: 1000,
  },
} as const;