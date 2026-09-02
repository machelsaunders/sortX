-- AlterTable
ALTER TABLE "Bookmark" ADD COLUMN "lang" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "likeCount" INTEGER;
ALTER TABLE "Bookmark" ADD COLUMN "quotedText" TEXT;
ALTER TABLE "Bookmark" ADD COLUMN "replyCount" INTEGER;
ALTER TABLE "Bookmark" ADD COLUMN "retweetCount" INTEGER;
ALTER TABLE "Bookmark" ADD COLUMN "viewCount" INTEGER;

-- CreateTable
CREATE TABLE "BookmarkEmbedding" (
    "bookmarkId" TEXT NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL,
    "dim" INTEGER NOT NULL,
    "vector" BLOB NOT NULL,
    "docHash" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookmarkEmbedding_bookmarkId_fkey" FOREIGN KEY ("bookmarkId") REFERENCES "Bookmark" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Bookmark_likeCount_idx" ON "Bookmark"("likeCount");
