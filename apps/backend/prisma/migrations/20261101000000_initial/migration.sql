BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('email_verification', 'password_reset', 'email_change');

-- CreateEnum
CREATE TYPE "GuestTrialState" AS ENUM ('available', 'reserved', 'consumed');

-- CreateEnum
CREATE TYPE "FileFormat" AS ENUM ('jpg', 'png', 'docx', 'pdf');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('input', 'output');

-- CreateEnum
CREATE TYPE "FileRetention" AS ENUM ('temporary', 'saved');

-- CreateEnum
CREATE TYPE "StorageDeletionState" AS ENUM ('present', 'pending', 'deleted');

-- CreateEnum
CREATE TYPE "ConversionStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "BackgroundTaskType" AS ENUM ('conversion_dispatch', 'file_deletion', 'email_notification', 'cleanup_sweep');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "displayName" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" UUID NOT NULL,
    "autoSave" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pendingEmail" VARCHAR(254),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "prefix" VARCHAR(64) NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestSession" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tokenHash" TEXT NOT NULL,
    "trialState" "GuestTrialState" NOT NULL DEFAULT 'available',
    "reservedConversionId" UUID,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "credentialExpiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuestSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "guestSessionId" UUID,
    "objectKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "format" "FileFormat" NOT NULL,
    "detectedMime" VARCHAR(127) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "retention" "FileRetention" NOT NULL DEFAULT 'temporary',
    "expiresAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "storageDeletionState" "StorageDeletionState" NOT NULL DEFAULT 'present',
    "storageDeletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "guestSessionId" UUID,
    "sourceFileId" UUID NOT NULL,
    "resultFileId" UUID,
    "sourceFormat" "FileFormat" NOT NULL,
    "targetFormat" "FileFormat" NOT NULL,
    "status" "ConversionStatus" NOT NULL DEFAULT 'queued',
    "saveResult" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" VARCHAR(64),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingVersion" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundTask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "BackgroundTaskType" NOT NULL,
    "resourceId" UUID NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_tokenHash_key" ON "VerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "VerificationToken_userId_purpose_idx" ON "VerificationToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "VerificationToken_expiresAt_idx" ON "VerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_prefix_key" ON "ApiKey"("prefix");

-- CreateIndex
CREATE INDEX "ApiKey_userId_createdAt_idx" ON "ApiKey"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_tokenHash_key" ON "GuestSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "GuestSession_reservedConversionId_key" ON "GuestSession"("reservedConversionId");

-- CreateIndex
CREATE UNIQUE INDEX "File_objectKey_key" ON "File"("objectKey");

-- CreateIndex
CREATE INDEX "File_userId_createdAt_id_idx" ON "File"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "File_userId_format_createdAt_id_idx" ON "File"("userId", "format", "createdAt", "id");

-- CreateIndex
CREATE INDEX "File_guestSessionId_idx" ON "File"("guestSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_sourceFileId_key" ON "Conversion"("sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversion_resultFileId_key" ON "Conversion"("resultFileId");

-- CreateIndex
CREATE INDEX "Conversion_userId_createdAt_idx" ON "Conversion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversion_guestSessionId_createdAt_idx" ON "Conversion"("guestSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversion_status_updatedAt_idx" ON "Conversion"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundTask_deduplicationKey_key" ON "BackgroundTask"("deduplicationKey");

-- CreateIndex
CREATE INDEX "BackgroundTask_type_resourceId_idx" ON "BackgroundTask"("type", "resourceId");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "VerificationToken" ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "GuestSession" ADD CONSTRAINT "GuestSession_reservedConversionId_fkey" FOREIGN KEY ("reservedConversionId") REFERENCES "Conversion"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_guestSessionId_fkey" FOREIGN KEY ("guestSessionId") REFERENCES "GuestSession"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_resultFileId_fkey" FOREIGN KEY ("resultFileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

COMMIT;
