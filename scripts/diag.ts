import { prisma } from "../src/app/lib/prisma";

const run = async (): Promise<void> => {
  const msgs = await prisma.inboundMessage.findMany({
    orderBy: { timestamp: "desc" },
    take: 10,
    select: { senderRef: true, content: true, channelType: true, timestamp: true },
  });
  console.log("INBOUND_COUNT=" + msgs.length);
  for (const m of msgs) console.log(JSON.stringify(m));

  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { channelType: true, senderRef: true, state: true, updatedAt: true },
  });
  console.log("SESSION_COUNT=" + sessions.length);
  for (const s of sessions) console.log(JSON.stringify(s));
};

run()
  .catch((e) => {
    console.error("DIAG_ERROR:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());