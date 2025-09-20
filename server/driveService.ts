import { google, drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

// Supported file types for document extraction
const SUPPORTED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'text/plain',
  'text/csv',
  'application/rtf',
  'text/html'
];

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime: string;
  webViewLink: string;
  parents?: string[];
}

interface DriveFileContent {
  id: string;
  name: string;
  content: string;
  mimeType: string;
}

export class DriveService {
  private drive: drive_v3.Drive;
  private auth: OAuth2Client;

  constructor(accessToken: string) {
    this.auth = new google.auth.OAuth2();
    this.auth.setCredentials({ access_token: accessToken });
    this.drive = google.drive({ version: 'v3', auth: this.auth });
  }

  /**
   * List files from Google Drive with optional filtering
   */
  async listFiles(options: {
    pageSize?: number;
    pageToken?: string;
    query?: string;
    folderId?: string;
  } = {}): Promise<{
    files: DriveFile[];
    nextPageToken?: string;
  }> {
    try {
      const { pageSize = 50, pageToken, query, folderId } = options;
      
      // Build query string
      let q = `trashed = false and (${SUPPORTED_MIME_TYPES.map(type => `mimeType = '${type}'`).join(' or ')})`;
      
      if (folderId) {
        q += ` and '${folderId}' in parents`;
      }
      
      if (query) {
        q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
      }

      const response = await this.drive.files.list({
        q,
        pageSize,
        pageToken,
        fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, parents)',
        orderBy: 'modifiedTime desc'
      });

      const files: DriveFile[] = (response.data.files || []).map(file => ({
        id: file.id!,
        name: file.name!,
        mimeType: file.mimeType!,
        size: file.size || undefined,
        modifiedTime: file.modifiedTime!,
        webViewLink: file.webViewLink!,
        parents: file.parents || undefined
      }));

      return {
        files,
        nextPageToken: response.data.nextPageToken || undefined
      };
    } catch (error) {
      console.error('Error listing Drive files:', error);
      throw new Error('Failed to list Drive files');
    }
  }

  /**
   * Get file content from Google Drive
   */
  async getFileContent(fileId: string): Promise<DriveFileContent | null> {
    try {
      // Get file metadata first
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType'
      });

      const file = metadata.data;
      if (!file.id || !file.name || !file.mimeType) {
        throw new Error('Invalid file metadata');
      }

      let content = '';

      // Handle different file types
      if (file.mimeType === 'application/vnd.google-apps.document') {
        // Google Docs - export as plain text
        const response = await this.drive.files.export({
          fileId,
          mimeType: 'text/plain'
        });
        content = response.data as string;
      } else if (file.mimeType === 'text/plain' || file.mimeType === 'text/csv' || file.mimeType === 'text/html') {
        // Plain text files
        const response = await this.drive.files.get({
          fileId,
          alt: 'media'
        });
        content = response.data as string;
      } else {
        // For PDFs and other binary formats, we'll need to implement 
        // text extraction separately or return a placeholder
        content = `[Binary file: ${file.name}]`;
      }

      return {
        id: file.id,
        name: file.name,
        content,
        mimeType: file.mimeType
      };
    } catch (error) {
      console.error('Error getting file content:', error);
      return null;
    }
  }

  /**
   * Get file content as buffer for binary files (PDFs, Word docs, etc.)
   * NOTE: Do NOT use this for Google Docs - use getFileContent with export instead
   */
  async getFileBuffer(fileId: string): Promise<{ buffer: Buffer; mimeType: string; name: string } | null> {
    try {
      // Get file metadata first
      const metadata = await this.drive.files.get({
        fileId,
        fields: 'id, name, mimeType'
      });

      const file = metadata.data;
      if (!file.id || !file.name || !file.mimeType) {
        throw new Error('Invalid file metadata');
      }

      // Don't use getFileBuffer for Google Docs - they need to be exported, not downloaded
      if (file.mimeType === 'application/vnd.google-apps.document') {
        throw new Error('Google Docs should use getFileContent with export, not getFileBuffer');
      }

      // Download file content as buffer with proper responseType
      const response = await this.drive.files.get({
        fileId,
        alt: 'media'
      }, { 
        responseType: 'arraybuffer' 
      });

      const buffer = Buffer.from(response.data as ArrayBuffer);

      return {
        buffer,
        mimeType: file.mimeType,
        name: file.name
      };
    } catch (error) {
      console.error('Error getting file buffer:', error);
      return null;
    }
  }

  /**
   * Get folder structure from Google Drive
   */
  async getFolders(): Promise<DriveFile[]> {
    try {
      const response = await this.drive.files.list({
        q: "mimeType = 'application/vnd.google-apps.folder' and trashed = false",
        fields: 'files(id, name, modifiedTime, parents)',
        orderBy: 'name'
      });

      return (response.data.files || []).map(folder => ({
        id: folder.id!,
        name: folder.name!,
        mimeType: 'application/vnd.google-apps.folder',
        modifiedTime: folder.modifiedTime!,
        webViewLink: `https://drive.google.com/drive/folders/${folder.id}`,
        parents: folder.parents || undefined
      }));
    } catch (error) {
      console.error('Error getting folders:', error);
      throw new Error('Failed to get Drive folders');
    }
  }

  /**
   * Check if the provided access token has the required scopes
   */
  async verifyDriveAccess(): Promise<boolean> {
    try {
      // Try to list a single file to verify access
      await this.drive.files.list({
        pageSize: 1,
        fields: 'files(id)'
      });
      return true;
    } catch (error) {
      console.error('Drive access verification failed:', error);
      return false;
    }
  }

  /**
   * Get Drive quota information
   */
  async getStorageQuota(): Promise<{
    limit: string;
    usage: string;
    usageInDrive: string;
  } | null> {
    try {
      const response = await this.drive.about.get({
        fields: 'storageQuota'
      });

      const quota = response.data.storageQuota;
      if (!quota) return null;

      return {
        limit: quota.limit || '0',
        usage: quota.usage || '0',
        usageInDrive: quota.usageInDrive || '0'
      };
    } catch (error) {
      console.error('Error getting storage quota:', error);
      return null;
    }
  }
}

export { SUPPORTED_MIME_TYPES };