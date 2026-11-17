CREATE TYPE "RemotePlaybackStatus" AS ENUM ('IDLE', 'STARTING', 'PLAYING', 'PAUSED', 'COMPLETED', 'STOPPED', 'ERROR');
CREATE TYPE "RemoteEmbedStatus" AS ENUM ('NOT_LOADED', 'LOADING', 'LOADED', 'ERROR');

ALTER TABLE "RemoteRuntimeStatus"
ADD COLUMN "playbackStatus" "RemotePlaybackStatus" NOT NULL DEFAULT 'IDLE',
ADD COLUMN "embedStatus" "RemoteEmbedStatus" NOT NULL DEFAULT 'NOT_LOADED',
ADD COLUMN "playlistId" TEXT,
ADD COLUMN "currentVideoId" TEXT,
ADD COLUMN "currentPosition" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "currentTimeSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "playbackStartedAt" TIMESTAMP(3),
ADD COLUMN "lastPlaybackEventAt" TIMESTAMP(3),
ADD COLUMN "resumeOnStart" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "playbackSessionId" TEXT;

CREATE UNIQUE INDEX "RemoteRuntimeStatus_playbackSessionId_key"
ON "RemoteRuntimeStatus"("playbackSessionId");

CREATE INDEX "RemoteRuntimeStatus_playlistId_idx"
ON "RemoteRuntimeStatus"("playlistId");

CREATE INDEX "RemoteRuntimeStatus_currentVideoId_idx"
ON "RemoteRuntimeStatus"("currentVideoId");

ALTER TABLE "RemoteRuntimeStatus"
ADD CONSTRAINT "RemoteRuntimeStatus_playlistId_fkey"
FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemoteRuntimeStatus"
ADD CONSTRAINT "RemoteRuntimeStatus_currentVideoId_fkey"
FOREIGN KEY ("currentVideoId") REFERENCES "Video"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemoteRuntimeStatus"
ADD CONSTRAINT "RemoteRuntimeStatus_playbackSessionId_fkey"
FOREIGN KEY ("playbackSessionId") REFERENCES "PlaybackSession"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
