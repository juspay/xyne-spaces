#!/usr/bin/env tsx

import { PrismaClient } from '@prisma/client';
import { generatePlainTextContent } from '../src/utils/contentUtils';
import { repositories } from '../src/database/repositories';

const prisma = new PrismaClient();

interface BackfillStats {
  totalMessages: number;
  alreadyIndexed: number;
  needsIndexing: number;
  processedMessages: number;
  successfulUpdates: number;
  failedUpdates: number;
  emptyContentCount: number;
  startTime: Date;
  endTime?: Date;
}

async function backfillMessageSearch() {
  console.log('🚀 Starting backfill of message_search table...');
  
  const stats: BackfillStats = {
    totalMessages: 0,
    alreadyIndexed: 0,
    needsIndexing: 0,
    processedMessages: 0,
    successfulUpdates: 0,
    failedUpdates: 0,
    emptyContentCount: 0,
    startTime: new Date(),
  };

  try {
    // Get counts
    const totalCount = await prisma.message.count();
    const indexedCount = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::int as count FROM message_search
    `;
    
    stats.totalMessages = totalCount;
    stats.alreadyIndexed = Number(indexedCount[0].count);
    stats.needsIndexing = totalCount - stats.alreadyIndexed;

    console.log(`📊 Total messages: ${totalCount}`);
    console.log(`✅ Already indexed: ${stats.alreadyIndexed}`);
    console.log(`⏳ Need indexing: ${stats.needsIndexing}`);

    if (stats.needsIndexing === 0) {
      console.log('✅ All messages are already indexed!');
      return;
    }

    const BATCH_SIZE = 1000;
    let processedCount = 0;

    // Process messages in batches - only those NOT in message_search
    while (processedCount < stats.needsIndexing) {
      console.log(`\n🔄 Processing batch ${Math.floor(processedCount / BATCH_SIZE) + 1}/${Math.ceil(stats.needsIndexing / BATCH_SIZE)}...`);
      
      // Fetch messages that don't have search index entries
      const messages = await prisma.$queryRaw<Array<{ messageId: string; content: string }>>`
        SELECT m."messageId", m.content
        FROM messages m
        LEFT JOIN message_search ms ON m."messageId" = ms."messageId"
        WHERE ms."messageId" IS NULL
        ORDER BY m."createdAt" ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (messages.length === 0) {
        console.log('ℹ️  No more messages to process');
        break;
      }

      // Process each message in the batch
      for (const message of messages) {
        try {
          // Generate plain text content from rich content
          const plainTextContent = generatePlainTextContent(message.content);
          
          if (!plainTextContent.trim()) {
            stats.emptyContentCount++;
            console.log(`⚠️  Message ${message.messageId} resulted in empty plain text content`);
          }

          // Insert into message_search table (upsert handles conflicts)
          await repositories.messageSearch.upsert(message.messageId, plainTextContent);
          
          stats.successfulUpdates++;
        } catch (error) {
          stats.failedUpdates++;
          console.error(`❌ Failed to process message ${message.messageId}:`, error);
        }
      }

      processedCount += messages.length;
      stats.processedMessages = processedCount;

      // Log progress
      const progressPercent = Math.round((processedCount / stats.needsIndexing) * 100);
      console.log(`   ✅ Processed ${processedCount}/${stats.needsIndexing} messages (${progressPercent}%)`);
      console.log(`   ✅ Successful: ${stats.successfulUpdates}, Failed: ${stats.failedUpdates}`);

      // Brief pause to avoid overwhelming the database
      if (processedCount < stats.needsIndexing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

  } catch (error) {
    console.error('💥 Fatal error during backfill:', error);
    throw error;
  } finally {
    stats.endTime = new Date();
    await prisma.$disconnect();
    
    // Print final statistics
    printFinalStats(stats);
  }
}

function printFinalStats(stats: BackfillStats) {
  const duration = stats.endTime 
    ? (stats.endTime.getTime() - stats.startTime.getTime()) / 1000
    : 0;

  console.log('\n📈 BACKFILL COMPLETED');
  console.log('==========================================');
  console.log(`📊 Total messages in database: ${stats.totalMessages}`);
  console.log(`✅ Already indexed before backfill: ${stats.alreadyIndexed}`);
  console.log(`📝 Messages needing indexing: ${stats.needsIndexing}`);
  console.log(`✅ Successfully indexed: ${stats.successfulUpdates}`);
  console.log(`❌ Failed to index: ${stats.failedUpdates}`);
  console.log(`⚠️  Empty content results: ${stats.emptyContentCount}`);
  console.log(`⏱️  Total duration: ${duration.toFixed(2)} seconds`);
  
  if (stats.successfulUpdates > 0) {
    console.log(`⚡ Average speed: ${(stats.successfulUpdates / duration).toFixed(2)} messages/second`);
  }
  
  const finalIndexed = stats.alreadyIndexed + stats.successfulUpdates;
  const coverage = ((finalIndexed / stats.totalMessages) * 100).toFixed(2);
  console.log(`\n📊 Final coverage: ${finalIndexed}/${stats.totalMessages} (${coverage}%)`);
  
  if (stats.failedUpdates === 0 && stats.successfulUpdates === stats.needsIndexing) {
    console.log('🎉 All messages indexed successfully!');
  } else if (stats.failedUpdates > 0) {
    console.log(`⚠️  ${stats.failedUpdates} messages failed to index. Check logs above for details.`);
  }
  
  console.log('\n🔍 Next steps:');
  console.log('1. Test global search with: GET /api/search?query=test');
  console.log('2. Verify search results are accurate');
  console.log('3. Monitor search performance');
  console.log('4. Run this script again if you add more messages');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Cleaning up...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM. Cleaning up...');
  await prisma.$disconnect();
  process.exit(0);
});

// Run the backfill
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillMessageSearch()
    .catch((error) => {
      console.error('💥 Backfill failed:', error);
      process.exit(1);
    });
}

export { backfillMessageSearch };
