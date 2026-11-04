-- CreateEnum
CREATE TYPE "TextAuthor" AS ENUM ('PUBLIC_DOMAIN', 'TEACHER');

-- CreateTable
CREATE TABLE "Text" (
    "id" TEXT NOT NULL,
    "language" "RaceLanguage" NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "licence" TEXT NOT NULL,
    "authorType" "TextAuthor" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Text_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Text_contentHash_key" ON "Text"("contentHash");

-- CreateIndex
CREATE INDEX "Text_language_idx" ON "Text"("language");
