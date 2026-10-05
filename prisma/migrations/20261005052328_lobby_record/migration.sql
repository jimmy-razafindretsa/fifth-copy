-- CreateEnum
CREATE TYPE "LobbyType" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('WAITING', 'CLOSED');

-- CreateTable
CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "LobbyType" NOT NULL DEFAULT 'PRIVATE',
    "status" "LobbyStatus" NOT NULL DEFAULT 'WAITING',
    "hostUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lobby_code_key" ON "Lobby"("code");

-- CreateIndex
CREATE INDEX "Lobby_hostUserId_idx" ON "Lobby"("hostUserId");

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
