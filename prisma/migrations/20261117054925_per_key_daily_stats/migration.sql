-- AlterTable
ALTER TABLE "RaceKeystrokes" ADD COLUMN     "rolledUpAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CharStatDaily" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "char" TEXT NOT NULL,
    "layout" "KeyboardLayout" NOT NULL,
    "hits" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "timedHits" INTEGER NOT NULL,
    "totalMs" INTEGER NOT NULL,

    CONSTRAINT "CharStatDaily_pkey" PRIMARY KEY ("userId","day","char","layout")
);

-- CreateTable
CREATE TABLE "BigramStatDaily" (
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "pair" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "errors" INTEGER NOT NULL,
    "timedHits" INTEGER NOT NULL,
    "totalMs" INTEGER NOT NULL,

    CONSTRAINT "BigramStatDaily_pkey" PRIMARY KEY ("userId","day","pair")
);

-- CreateIndex
CREATE INDEX "BigramStatDaily_day_idx" ON "BigramStatDaily"("day");

-- CreateIndex
CREATE INDEX "RaceKeystrokes_rolledUpAt_createdAt_idx" ON "RaceKeystrokes"("rolledUpAt", "createdAt");

-- AddForeignKey
ALTER TABLE "CharStatDaily" ADD CONSTRAINT "CharStatDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BigramStatDaily" ADD CONSTRAINT "BigramStatDaily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
