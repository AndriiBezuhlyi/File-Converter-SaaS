BEGIN;
ALTER TABLE "File" DROP CONSTRAINT "File_mime_matches_format";
ALTER TABLE "File" ADD CONSTRAINT "File_mime_matches_format" CHECK (
  (format = 'jpg' AND "detectedMime" = 'image/jpeg')
  OR (format = 'png' AND "detectedMime" = 'image/png')
  OR (format = 'webp' AND "detectedMime" = 'image/webp')
  OR (format = 'avif' AND "detectedMime" = 'image/avif')
  OR (format = 'gif' AND "detectedMime" = 'image/gif')
  OR (format = 'svg' AND "detectedMime" = 'image/svg+xml')
  OR (format = 'docx' AND "detectedMime" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  OR (format = 'pdf' AND "detectedMime" = 'application/pdf')
);
ALTER TABLE "Conversion" DROP CONSTRAINT "Conversion_supported_pair";
ALTER TABLE "Conversion" ADD CONSTRAINT "Conversion_supported_pair" CHECK (
  ("sourceFormat" = 'jpg' AND "targetFormat" IN ('png', 'webp', 'avif'))
  OR ("sourceFormat" = 'png' AND "targetFormat" IN ('jpg', 'webp', 'avif'))
  OR ("sourceFormat" = 'webp' AND "targetFormat" IN ('jpg', 'png', 'avif'))
  OR ("sourceFormat" = 'avif' AND "targetFormat" IN ('jpg', 'png', 'webp'))
  OR ("sourceFormat" = 'gif' AND "targetFormat" IN ('jpg', 'png', 'webp', 'avif'))
  OR ("sourceFormat" = 'svg' AND "targetFormat" IN ('jpg', 'png', 'webp', 'avif'))
  OR ("sourceFormat" = 'docx' AND "targetFormat" IN ('pdf'))
);
COMMIT;
