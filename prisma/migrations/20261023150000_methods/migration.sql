-- CreateTable
CREATE TABLE "Method" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "minimum" INTEGER NOT NULL,
    "minimumRule" TEXT NOT NULL DEFAULT 'total',
    "tiers" JSONB NOT NULL,
    "setupFee" DOUBLE PRECISION NOT NULL,
    "includedStitches" INTEGER,
    "perThousandStitches" DOUBLE PRECISION,
    "includedColors" INTEGER NOT NULL,
    "perExtraColor" DOUBLE PRECISION NOT NULL,
    "customColorFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxColors" INTEGER,
    "leadTime" TEXT NOT NULL DEFAULT '',
    "colorNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Method_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Method_shop_key_key" ON "Method"("shop", "key");
