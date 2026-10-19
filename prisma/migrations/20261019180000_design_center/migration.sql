-- AlterTable
ALTER TABLE "Submission" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'new',
ADD COLUMN "attention" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "token" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "artworkFileId" TEXT,
ADD COLUMN "artworkData" BYTEA,
ADD COLUMN "proofFileId" TEXT,
ADD COLUMN "proofData" BYTEA,
ADD COLUMN "proofType" TEXT,
ADD COLUMN "proofName" TEXT,
ADD COLUMN "proofSentAt" TIMESTAMP(3),
ADD COLUMN "approvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Submission_token_key" ON "Submission"("token");

-- CreateIndex
CREATE INDEX "Submission_shop_stage_idx" ON "Submission"("shop", "stage");

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "author" TEXT NOT NULL,
    "authorName" TEXT,
    "body" TEXT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_submissionId_createdAt_idx" ON "Message"("submissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
