-- AlterTable
ALTER TABLE "Race" ADD COLUMN     "hostUserId" TEXT;

-- CreateIndex
CREATE INDEX "Race_hostUserId_idx" ON "Race"("hostUserId");

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
