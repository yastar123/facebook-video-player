CREATE TYPE "RuntimeProcessState" AS ENUM ('STARTING', 'ONLINE', 'STOPPING', 'OFFLINE', 'ERROR');
CREATE TYPE "RemoteBrowserState" AS ENUM ('CLOSED', 'STARTING', 'OPEN', 'CRASHED');

CREATE TABLE "RemoteRuntimeStatus" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "processState" "RuntimeProcessState" NOT NULL DEFAULT 'OFFLINE',
    "browserState" "RemoteBrowserState" NOT NULL DEFAULT 'CLOSED',
    "chromiumVersion" TEXT,
    "processStartedAt" TIMESTAMP(3),
    "browserStartedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "currentPage" TEXT,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RemoteRuntimeStatus_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemoteRuntimeLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemoteRuntimeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RemoteRuntimeLog_createdAt_idx" ON "RemoteRuntimeLog"("createdAt");
