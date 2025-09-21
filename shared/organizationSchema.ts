import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, boolean, integer, varchar, index, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Organizations table - adapted to match existing varchar ID pattern
export const organizations = pgTable('organizations', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  subdomain: text('subdomain').unique().notNull(), // for multi-tenant routing
  plan: text('plan').notNull().default('free'), // free, pro, enterprise
  maxUsers: integer('max_users').notNull().default(5),
  maxStorage: integer('max_storage_gb').notNull().default(10),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),

  // Compliance settings
  dataRetentionDays: integer('data_retention_days').default(2555), // 7 years default
  requireMfa: boolean('require_mfa').default(false),
  allowGuestAccess: boolean('allow_guest_access').default(false),

  // Billing
  billingEmail: text('billing_email'),
  subscriptionId: text('subscription_id'),
  subscriptionStatus: text('subscription_status').default('active'),
}, (table) => ({
  subdomainIdx: index('organizations_subdomain_idx').on(table.subdomain),
}));

// User roles within organizations
export const userRoles = pgTable('user_roles', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: text('user_id').notNull(), // Firebase UID
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(), // owner, admin, editor, viewer, auditor
  permissions: text('permissions').array(), // granular permissions
  invitedBy: text('invited_by'), // Firebase UID of inviter
  invitedAt: timestamp('invited_at').default(sql`now()`),
  acceptedAt: timestamp('accepted_at'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
}, (table) => ({
  userOrgIdx: index('user_roles_user_org_idx').on(table.userId, table.organizationId),
  uniqueUserOrg: unique('user_roles_user_org_unique').on(table.userId, table.organizationId),
}));

// Audit log for all user actions
export const auditLogs = pgTable('audit_logs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: text('user_id'), // Firebase UID (null for system actions)
  action: text('action').notNull(), // CREATE, READ, UPDATE, DELETE, EXPORT, etc.
  resourceType: text('resource_type').notNull(), // document, user, organization, etc.
  resourceId: text('resource_id'), // ID of affected resource
  details: text('details'), // JSON string with action details
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  timestamp: timestamp('timestamp').default(sql`now()`).notNull(),

  // Compliance metadata
  dataClassification: text('data_classification'), // public, internal, confidential, restricted
  complianceFlags: text('compliance_flags').array(), // GDPR, HIPAA, SOX, etc.
}, (table) => ({
  orgTimeIdx: index('audit_logs_org_time_idx').on(table.organizationId, table.timestamp),
  userTimeIdx: index('audit_logs_user_time_idx').on(table.userId, table.timestamp),
  actionIdx: index('audit_logs_action_idx').on(table.action),
}));

// Enhanced background jobs table - extending existing AI queue concept
export const backgroundJobs = pgTable('background_jobs', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // ai_analysis, bulk_upload, data_export, data_cleanup, etc.
  status: text('status').notNull().default('pending'), // pending, processing, completed, failed, cancelled
  priority: integer('priority').notNull().default(5), // 1-10, higher = more urgent

  // Idempotency
  idempotencyKey: text('idempotency_key').unique(),

  // Job data
  payload: text('payload').notNull(), // JSON string
  result: text('result'), // JSON string with results
  errorMessage: text('error_message'),

  // Scheduling
  scheduledFor: timestamp('scheduled_for').default(sql`now()`),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),

  // Retry logic
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),

  // Metadata
  createdBy: text('created_by'), // Firebase UID
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
}, (table) => ({
  statusIdx: index('background_jobs_status_idx').on(table.status),
  scheduledIdx: index('background_jobs_scheduled_idx').on(table.scheduledFor),
  idempotencyIdx: index('background_jobs_idempotency_idx').on(table.idempotencyKey),
  orgTypeIdx: index('background_jobs_org_type_idx').on(table.organizationId, table.type),
}));

// Data classification and lifecycle
export const dataClassifications = pgTable('data_classifications', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  documentId: varchar('document_id').notNull(),

  // Classification
  classification: text('classification').notNull(), // public, internal, confidential, restricted
  classifiedBy: text('classified_by'), // Firebase UID or 'system'
  classifiedAt: timestamp('classified_at').default(sql`now()`).notNull(),

  // Lifecycle
  retentionPeriodDays: integer('retention_period_days'),
  deleteAfter: timestamp('delete_after'),
  isArchived: boolean('is_archived').default(false),
  archivedAt: timestamp('archived_at'),

  // Compliance
  complianceFrameworks: text('compliance_frameworks').array(), // GDPR, HIPAA, SOX, etc.
  legalHoldIds: text('legal_hold_ids').array(),

  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
}, (table) => ({
  docIdx: index('data_classifications_doc_idx').on(table.documentId),
  classificationIdx: index('data_classifications_classification_idx').on(table.classification),
  deleteAfterIdx: index('data_classifications_delete_after_idx').on(table.deleteAfter),
}));

// Organization settings for fine-grained configuration
export const organizationSettings = pgTable('organization_settings', {
  id: varchar('id').primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  
  // Feature flags
  aiAnalysisEnabled: boolean('ai_analysis_enabled').default(true),
  bulkUploadEnabled: boolean('bulk_upload_enabled').default(true),
  googleDriveIntegration: boolean('google_drive_integration').default(false),
  
  // Security settings
  sessionTimeoutMinutes: integer('session_timeout_minutes').default(480), // 8 hours
  maxFailedLogins: integer('max_failed_logins').default(5),
  passwordExpireDays: integer('password_expire_days').default(90),
  
  // Storage settings
  maxFileSize: integer('max_file_size_mb').default(50),
  allowedFileTypes: text('allowed_file_types').array(),
  autoArchiveAfterDays: integer('auto_archive_after_days').default(365),
  
  // Compliance settings
  auditRetentionDays: integer('audit_retention_days').default(2555), // 7 years
  exportFormat: text('export_format').default('pdf'), // pdf, docx, csv
  
  createdAt: timestamp('created_at').default(sql`now()`).notNull(),
  updatedAt: timestamp('updated_at').default(sql`now()`).notNull(),
}, (table) => ({
  uniqueOrgSettings: unique('organization_settings_org_unique').on(table.organizationId),
}));

// Relations
export const organizationsRelations = relations(organizations, ({ many, one }) => ({
  userRoles: many(userRoles),
  auditLogs: many(auditLogs),
  backgroundJobs: many(backgroundJobs),
  dataClassifications: many(dataClassifications),
  settings: one(organizationSettings, {
    fields: [organizations.id],
    references: [organizationSettings.organizationId],
  }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  organization: one(organizations, {
    fields: [userRoles.organizationId],
    references: [organizations.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
}));

export const backgroundJobsRelations = relations(backgroundJobs, ({ one }) => ({
  organization: one(organizations, {
    fields: [backgroundJobs.organizationId],
    references: [organizations.id],
  }),
}));

export const dataClassificationsRelations = relations(dataClassifications, ({ one }) => ({
  organization: one(organizations, {
    fields: [dataClassifications.organizationId],
    references: [organizations.id],
  }),
}));

export const organizationSettingsRelations = relations(organizationSettings, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationSettings.organizationId],
    references: [organizations.id],
  }),
}));

// Zod schemas for validation
export const insertOrganizationSchema = createInsertSchema(organizations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertUserRoleSchema = createInsertSchema(userRoles).omit({
  id: true,
  createdAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).omit({
  id: true,
  timestamp: true,
});

export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertDataClassificationSchema = createInsertSchema(dataClassifications).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertOrganizationSettingsSchema = createInsertSchema(organizationSettings).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Type exports
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = z.infer<typeof insertOrganizationSchema>;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = z.infer<typeof insertUserRoleSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = z.infer<typeof insertAuditLogSchema>;
export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type NewBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;
export type DataClassification = typeof dataClassifications.$inferSelect;
export type NewDataClassification = z.infer<typeof insertDataClassificationSchema>;
export type OrganizationSettings = typeof organizationSettings.$inferSelect;
export type NewOrganizationSettings = z.infer<typeof insertOrganizationSettingsSchema>;

// Permission constants
export const PERMISSIONS = {
  // Document permissions
  DOCUMENTS_READ: 'documents:read',
  DOCUMENTS_CREATE: 'documents:create',
  DOCUMENTS_UPDATE: 'documents:update',
  DOCUMENTS_DELETE: 'documents:delete',
  DOCUMENTS_EXPORT: 'documents:export',
  
  // User management permissions
  USERS_READ: 'users:read',
  USERS_INVITE: 'users:invite',
  USERS_UPDATE: 'users:update',
  USERS_DELETE: 'users:delete',
  
  // Organization permissions
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_UPDATE: 'organization:update',
  ORGANIZATION_DELETE: 'organization:delete',
  ORGANIZATION_SETTINGS: 'organization:settings',
  
  // Audit permissions
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',
  
  // System permissions
  SYSTEM_ADMIN: 'system:admin',
} as const;

// Role-based permission sets
export const ROLE_PERMISSIONS = {
  owner: Object.values(PERMISSIONS),
  admin: [
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.DOCUMENTS_UPDATE,
    PERMISSIONS.DOCUMENTS_DELETE,
    PERMISSIONS.DOCUMENTS_EXPORT,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_INVITE,
    PERMISSIONS.USERS_UPDATE,
    PERMISSIONS.ORGANIZATION_READ,
    PERMISSIONS.ORGANIZATION_UPDATE,
    PERMISSIONS.ORGANIZATION_SETTINGS,
    PERMISSIONS.AUDIT_READ,
  ],
  editor: [
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.DOCUMENTS_CREATE,
    PERMISSIONS.DOCUMENTS_UPDATE,
    PERMISSIONS.DOCUMENTS_EXPORT,
    PERMISSIONS.USERS_READ,
  ],
  viewer: [
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.USERS_READ,
  ],
  auditor: [
    PERMISSIONS.DOCUMENTS_READ,
    PERMISSIONS.USERS_READ,
    PERMISSIONS.ORGANIZATION_READ,
    PERMISSIONS.AUDIT_READ,
    PERMISSIONS.AUDIT_EXPORT,
  ],
} as const;