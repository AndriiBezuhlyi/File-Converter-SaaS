BEGIN;

-- Prisma 7 cannot express these checks and guards. Preserve them in future migrations.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_normalized" CHECK (email = lower(btrim(email)) AND length(email) > 0),
  ADD CONSTRAINT "User_password_hash_present" CHECK (length(btrim("passwordHash")) > 0);

ALTER TABLE "VerificationToken"
  ADD CONSTRAINT "VerificationToken_hash_present" CHECK (length(btrim("tokenHash")) > 0),
  ADD CONSTRAINT "VerificationToken_attempts_nonnegative" CHECK (attempts >= 0),
  ADD CONSTRAINT "VerificationToken_expiry_valid" CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "VerificationToken_consumption_valid" CHECK ("consumedAt" IS NULL OR "consumedAt" >= "createdAt"),
  ADD CONSTRAINT "VerificationToken_email_change_target" CHECK (
    (purpose = 'email_change' AND "pendingEmail" IS NOT NULL AND length("pendingEmail") > 0
      AND "pendingEmail" = lower(btrim("pendingEmail")))
    OR (purpose <> 'email_change' AND "pendingEmail" IS NULL)
  );

ALTER TABLE "ApiKey"
  ADD CONSTRAINT "ApiKey_secret_present" CHECK (length(btrim("secretHash")) > 0 AND length(btrim(prefix)) > 0),
  ADD CONSTRAINT "ApiKey_revocation_valid" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt");
CREATE UNIQUE INDEX "ApiKey_one_active_per_user" ON "ApiKey" ("userId") WHERE "revokedAt" IS NULL;

ALTER TABLE "GuestSession"
  ADD CONSTRAINT "GuestSession_hash_present" CHECK (length(btrim("tokenHash")) > 0),
  ADD CONSTRAINT "GuestSession_expiry_valid" CHECK ("credentialExpiresAt" > "createdAt"),
  ADD CONSTRAINT "GuestSession_trial_shape" CHECK (
    ("trialState" = 'available' AND "reservedConversionId" IS NULL AND "consumedAt" IS NULL)
    OR ("trialState" = 'reserved' AND "reservedConversionId" IS NOT NULL AND "consumedAt" IS NULL)
    OR ("trialState" = 'consumed' AND "reservedConversionId" IS NULL AND "consumedAt" IS NOT NULL
      AND "consumedAt" >= "createdAt")
  );

ALTER TABLE "File"
  ADD CONSTRAINT "File_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("guestSessionId" IS NOT NULL)),
  ADD CONSTRAINT "File_size_positive" CHECK ("sizeBytes" > 0),
  ADD CONSTRAINT "File_names_present" CHECK (length(btrim("objectKey")) > 0 AND length("originalName") > 0),
  ADD CONSTRAINT "File_mime_matches_format" CHECK (
    (format = 'jpg' AND "detectedMime" = 'image/jpeg')
    OR (format = 'png' AND "detectedMime" = 'image/png')
    OR (format = 'docx' AND "detectedMime" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR (format = 'pdf' AND "detectedMime" = 'application/pdf')
  ),
  ADD CONSTRAINT "File_retention_shape" CHECK (
    (retention = 'saved' AND purpose = 'output' AND "userId" IS NOT NULL AND "expiresAt" IS NULL)
    OR (retention = 'temporary' AND (purpose = 'input' OR "expiresAt" IS NOT NULL))
  ),
  ADD CONSTRAINT "File_deletion_shape" CHECK (
    ("storageDeletionState" = 'present' AND "deletedAt" IS NULL AND "storageDeletedAt" IS NULL)
    OR ("storageDeletionState" = 'pending' AND "deletedAt" IS NOT NULL AND "storageDeletedAt" IS NULL)
    OR ("storageDeletionState" = 'deleted' AND "deletedAt" IS NOT NULL AND "storageDeletedAt" IS NOT NULL)
  );
CREATE INDEX "File_temporary_expiry" ON "File" ("expiresAt", id)
  WHERE retention = 'temporary' AND "deletedAt" IS NULL;
CREATE INDEX "File_pending_deletion" ON "File" ("deletedAt", id)
  WHERE "storageDeletionState" = 'pending';

ALTER TABLE "Conversion"
  ADD CONSTRAINT "Conversion_exactly_one_owner" CHECK (("userId" IS NOT NULL) <> ("guestSessionId" IS NOT NULL)),
  ADD CONSTRAINT "Conversion_guest_not_saved" CHECK ("guestSessionId" IS NULL OR NOT "saveResult"),
  ADD CONSTRAINT "Conversion_supported_pair" CHECK (
    ("sourceFormat" = 'jpg' AND "targetFormat" = 'png')
    OR ("sourceFormat" = 'png' AND "targetFormat" = 'jpg')
    OR ("sourceFormat" = 'docx' AND "targetFormat" = 'pdf')
  ),
  ADD CONSTRAINT "Conversion_attempts_nonnegative" CHECK (attempts >= 0 AND "processingVersion" >= 0),
  ADD CONSTRAINT "Conversion_distinct_files" CHECK ("resultFileId" IS NULL OR "sourceFileId" <> "resultFileId"),
  ADD CONSTRAINT "Conversion_status_shape" CHECK (
    (status = 'queued' AND "resultFileId" IS NULL AND "completedAt" IS NULL AND "failedAt" IS NULL
      AND "errorCode" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
    OR (status = 'processing' AND "resultFileId" IS NULL AND "completedAt" IS NULL AND "failedAt" IS NULL
      AND "errorCode" IS NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "startedAt" IS NOT NULL)
    OR (status = 'completed' AND "resultFileId" IS NOT NULL AND "completedAt" IS NOT NULL AND "failedAt" IS NULL
      AND "errorCode" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
    OR (status = 'failed' AND "resultFileId" IS NULL AND "completedAt" IS NULL AND "failedAt" IS NOT NULL
      AND "errorCode" IS NOT NULL AND length("errorCode") > 0 AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL)
  );
CREATE UNIQUE INDEX "Conversion_one_active_per_guest" ON "Conversion" ("guestSessionId")
  WHERE "guestSessionId" IS NOT NULL AND status IN ('queued', 'processing');
CREATE UNIQUE INDEX "Conversion_one_success_per_guest" ON "Conversion" ("guestSessionId")
  WHERE "guestSessionId" IS NOT NULL AND status = 'completed';
CREATE INDEX "Conversion_processing_lease" ON "Conversion" ("leaseExpiresAt", id) WHERE status = 'processing';

ALTER TABLE "BackgroundTask"
  ADD CONSTRAINT "BackgroundTask_payload_object" CHECK (jsonb_typeof(payload) = 'object'),
  ADD CONSTRAINT "BackgroundTask_version_attempts_valid" CHECK ("payloadVersion" > 0 AND attempts >= 0),
  ADD CONSTRAINT "BackgroundTask_key_present" CHECK (length(btrim("deduplicationKey")) > 0),
  ADD CONSTRAINT "BackgroundTask_lease_shape" CHECK (("leaseToken" IS NULL) = ("leaseExpiresAt" IS NULL)),
  ADD CONSTRAINT "BackgroundTask_completed_not_leased" CHECK ("completedAt" IS NULL OR "leaseToken" IS NULL);
CREATE INDEX "BackgroundTask_pending_available" ON "BackgroundTask" ("availableAt", id) WHERE "completedAt" IS NULL;
CREATE INDEX "BackgroundTask_pending_lease" ON "BackgroundTask" ("leaseExpiresAt", id)
  WHERE "completedAt" IS NULL AND "leaseToken" IS NOT NULL;

-- A nullable multi-column FK can skip ownership checks under MATCH SIMPLE.
-- Explicit guards check both account and guest owners. Referenced identity is immutable.
CREATE FUNCTION guard_file_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."userId", NEW."guestSessionId", NEW.purpose, NEW.format, NEW.retention)
       IS DISTINCT FROM ROW(OLD."userId", OLD."guestSessionId", OLD.purpose, OLD.format, OLD.retention)
     OR (OLD.purpose = 'output' AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt") THEN
    RAISE EXCEPTION 'File ownership, type and retention are immutable'
      USING ERRCODE = '23514', CONSTRAINT = 'File_identity_immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "File_identity_guard" BEFORE UPDATE ON "File" FOR EACH ROW EXECUTE FUNCTION guard_file_identity();

CREATE FUNCTION guard_conversion_files() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row "File"%ROWTYPE;
  result_row "File"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW."userId", NEW."guestSessionId", NEW."sourceFileId", NEW."sourceFormat", NEW."targetFormat", NEW."saveResult")
      IS DISTINCT FROM ROW(OLD."userId", OLD."guestSessionId", OLD."sourceFileId", OLD."sourceFormat", OLD."targetFormat", OLD."saveResult") THEN
      RAISE EXCEPTION 'Conversion ownership and acceptance snapshot are immutable'
        USING ERRCODE = '23514', CONSTRAINT = 'Conversion_snapshot_immutable';
    END IF;
    IF OLD.status IN ('completed', 'failed') AND
      ROW(NEW.status, NEW."resultFileId", NEW."completedAt", NEW."failedAt", NEW."errorCode")
      IS DISTINCT FROM ROW(OLD.status, OLD."resultFileId", OLD."completedAt", OLD."failedAt", OLD."errorCode") THEN
      RAISE EXCEPTION 'Terminal conversion cannot be reopened or republished'
        USING ERRCODE = '23514', CONSTRAINT = 'Conversion_terminal_immutable';
    END IF;
  END IF;
  SELECT * INTO source_row FROM "File" WHERE id = NEW."sourceFileId" FOR SHARE;
  IF source_row.id IS NULL THEN
    RAISE EXCEPTION 'Conversion input does not exist'
      USING ERRCODE = '23503', CONSTRAINT = 'Conversion_sourceFileId_fkey';
  END IF;
  IF (
    source_row."userId" IS DISTINCT FROM NEW."userId" OR source_row."guestSessionId" IS DISTINCT FROM NEW."guestSessionId"
    OR source_row.purpose <> 'input' OR source_row.format <> NEW."sourceFormat") THEN
    RAISE EXCEPTION 'Conversion input does not match its owner, purpose or format'
      USING ERRCODE = '23514', CONSTRAINT = 'Conversion_source_matches';
  END IF;
  IF NEW."resultFileId" IS NOT NULL THEN
    SELECT * INTO result_row FROM "File" WHERE id = NEW."resultFileId" FOR SHARE;
    IF result_row.id IS NULL THEN
      RAISE EXCEPTION 'Conversion output does not exist'
        USING ERRCODE = '23503', CONSTRAINT = 'Conversion_resultFileId_fkey';
    END IF;
    IF (
      result_row."userId" IS DISTINCT FROM NEW."userId" OR result_row."guestSessionId" IS DISTINCT FROM NEW."guestSessionId"
      OR result_row.purpose <> 'output' OR result_row.format <> NEW."targetFormat"
      OR (NEW."saveResult" AND result_row.retention <> 'saved')
      OR (NOT NEW."saveResult" AND result_row.retention <> 'temporary')
      OR (NOT NEW."saveResult" AND result_row."expiresAt" <= NEW."completedAt")) THEN
      RAISE EXCEPTION 'Conversion output does not match its owner, format or retention snapshot'
        USING ERRCODE = '23514', CONSTRAINT = 'Conversion_result_matches';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Conversion_files_guard" BEFORE INSERT OR UPDATE ON "Conversion"
  FOR EACH ROW EXECUTE FUNCTION guard_conversion_files();

CREATE FUNCTION guard_guest_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  conversion_guest uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."trialState" = 'consumed' AND
    ROW(NEW."trialState", NEW."consumedAt") IS DISTINCT FROM ROW(OLD."trialState", OLD."consumedAt") THEN
    RAISE EXCEPTION 'A consumed trial cannot be renewed'
      USING ERRCODE = '23514', CONSTRAINT = 'GuestSession_consumed_immutable';
  END IF;
  IF NEW."reservedConversionId" IS NOT NULL THEN
    SELECT "guestSessionId" INTO conversion_guest FROM "Conversion" WHERE id = NEW."reservedConversionId" FOR SHARE;
    IF conversion_guest IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Guest reservation must reference its own conversion'
        USING ERRCODE = '23514', CONSTRAINT = 'GuestSession_reservation_owner';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "GuestSession_reservation_guard" BEFORE INSERT OR UPDATE ON "GuestSession"
  FOR EACH ROW EXECUTE FUNCTION guard_guest_reservation();

COMMIT;
