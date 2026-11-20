-- CreateEnum
CREATE TYPE "RaceTextType" AS ENUM ('SENTENCES', 'WORDS', 'SPECIAL_CHARACTERS');

-- CreateEnum
CREATE TYPE "RaceLength" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- AlterTable
ALTER TABLE "RaceResult" ADD COLUMN     "wpmSeries" JSONB;

-- CreateTable
CREATE TABLE "Achievement" (
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("userId","achievementId")
);

-- CreateTable
CREATE TABLE "PersonalBest" (
    "userId" TEXT NOT NULL,
    "language" "RaceLanguage" NOT NULL,
    "textType" "RaceTextType" NOT NULL,
    "length" "RaceLength" NOT NULL,
    "cleanWpm" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION NOT NULL,
    "raceId" TEXT,
    "achievedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalBest_pkey" PRIMARY KEY ("userId","language","textType","length")
);

-- CreateIndex
CREATE INDEX "PersonalBest_raceId_idx" ON "PersonalBest"("raceId");

-- CreateIndex
CREATE INDEX "RaceResult_createdAt_idx" ON "RaceResult"("createdAt");

-- AddForeignKey
ALTER TABLE "Achievement" ADD CONSTRAINT "Achievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalBest" ADD CONSTRAINT "PersonalBest_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE SET NULL ON UPDATE CASCADE;
