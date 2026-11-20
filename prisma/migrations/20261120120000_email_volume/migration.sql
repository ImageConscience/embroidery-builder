-- Staff email for customer messages, and apron volume discount tiers.
ALTER TABLE "ShopSettings" ADD COLUMN "contactEmail" TEXT;
ALTER TABLE "ShopSettings" ADD COLUMN "emailNew" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "VolumeDiscounts" (
    "shop" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "fileName" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VolumeDiscounts_pkey" PRIMARY KEY ("shop")
);
