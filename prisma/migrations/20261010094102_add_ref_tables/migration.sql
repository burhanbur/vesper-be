-- CreateTable
CREATE TABLE "ref_account_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ref_account_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ref_categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "category_type" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ref_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ref_account_types_name_key" ON "ref_account_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ref_categories_name_type_key" ON "ref_categories"("name", "type");
