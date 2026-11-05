import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// mkdtemp creates a process-owned 0700 directory; Multer generates opaque file names.
export const UPLOAD_STAGING_DIRECTORY = mkdtempSync(join(tmpdir(), 'converter-upload-'));
