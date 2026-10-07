-- CreateEnum
CREATE TYPE "RaceLanguage" AS ENUM ('FR', 'EN');

-- CreateEnum
CREATE TYPE "RaceEndReason" AS ENUM ('ALL_FINISHED', 'TIMER', 'VOID');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('FINISHED', 'REASSIGNED', 'ASLEEP', 'EXPIRED', 'LINE_CUT', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "textContent" TEXT NOT NULL,
    "textLanguage" "RaceLanguage" NOT NULL,
    "textWordCount" INTEGER NOT NULL,
    "textSourceRef" TEXT,
    "settings" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" "RaceEndReason",
    "lobbySize" INTEGER,
    "engineVersion" TEXT NOT NULL,
    "protocolVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceResult" (
    "id" TEXT NOT NULL,
    "raceId" TEXT NOT NULL,
    "userId" TEXT,
    "desk" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "isBot" BOOLEAN NOT NULL,
    "place" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "wpm" DOUBLE PRECISION NOT NULL,
    "rawWpm" DOUBLE PRECISION NOT NULL,
    "cleanWpm" DOUBLE PRECISION NOT NULL,
    "adjustedWpm" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "progress" DOUBLE PRECISION NOT NULL,
    "correct" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "finishedAtMs" INTEGER,
    "bonusesSent" INTEGER NOT NULL,
    "bonusesReceived" INTEGER NOT NULL,
    "bonusLog" JSONB NOT NULL,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspiciousReason" TEXT,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceKeystrokes" (
    "raceId" TEXT NOT NULL,
    "desk" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "count" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaceKeystrokes_pkey" PRIMARY KEY ("raceId","desk")
);

-- CreateIndex
CREATE INDEX "Race_lobbyId_idx" ON "Race"("lobbyId");

-- CreateIndex
CREATE INDEX "RaceResult_userId_idx" ON "RaceResult"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceResult_raceId_desk_key" ON "RaceResult"("raceId", "desk");

-- CreateIndex
CREATE INDEX "RaceKeystrokes_createdAt_idx" ON "RaceKeystrokes"("createdAt");

-- CreateIndex
CREATE INDEX "RaceKeystrokes_userId_idx" ON "RaceKeystrokes"("userId");

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceKeystrokes" ADD CONSTRAINT "RaceKeystrokes_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceKeystrokes" ADD CONSTRAINT "RaceKeystrokes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
