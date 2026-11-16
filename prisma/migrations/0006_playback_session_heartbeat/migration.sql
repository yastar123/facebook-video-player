ALTER TABLE "PlaybackSession"
ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "PlaybackSession"
SET "lastHeartbeatAt" = "startedAt";

CREATE INDEX "PlaybackSession_status_lastHeartbeatAt_idx"
ON "PlaybackSession"("status", "lastHeartbeatAt");
