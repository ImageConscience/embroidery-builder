-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'new',
    "customerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "company" TEXT,
    "notes" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "zoneLabel" TEXT,
    "quantity" INTEGER NOT NULL,
    "estTotal" DOUBLE PRECISION,
    "spec" JSONB NOT NULL,
    "logoName" TEXT NOT NULL,
    "logoType" TEXT NOT NULL,
    "logoFileId" TEXT,
    "mockupFileId" TEXT,
    "logoData" BYTEA,
    "mockupData" BYTEA,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_shop_createdAt_idx" ON "Submission"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_number_key" ON "Submission"("number");

-- Start reference numbers at 1001 (EMB-1001)
ALTER SEQUENCE "Submission_number_seq" RESTART WITH 1001;
