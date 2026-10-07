-- DropForeignKey
ALTER TABLE "Race" DROP CONSTRAINT "Race_lobbyId_fkey";

-- AlterTable
ALTER TABLE "Race" ALTER COLUMN "lobbyId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE SET NULL ON UPDATE CASCADE;
