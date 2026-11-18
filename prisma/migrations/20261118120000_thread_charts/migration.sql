-- Vendor thread charts (Pantone → thread number) and the chart each method uses.
ALTER TABLE "Method" ADD COLUMN "threadChartId" TEXT;

CREATE TABLE "ThreadChart" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL DEFAULT '',
    "rows" JSONB NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ThreadChart_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ThreadChart_shop_idx" ON "ThreadChart"("shop");
