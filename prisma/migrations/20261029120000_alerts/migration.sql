-- Notifications settings and staff alerts.
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "slackWebhook" TEXT,
    "notifyNew" BOOLEAN NOT NULL DEFAULT true,
    "notifyReply" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);

CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "detail" TEXT,
    "submissionId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Alert_shop_resolvedAt_createdAt_idx" ON "Alert"("shop", "resolvedAt", "createdAt");
