import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function cleanDummyData() {
  console.log("Cleaning hardcoded dummy records from database...");

  // 1. Remove hardcoded dummy order #ORD-2501
  const dummyOrder = await prisma.order.findUnique({
    where: { orderNumber: "#ORD-2501" },
    select: { id: true },
  });

  if (dummyOrder) {
    await prisma.orderItem.deleteMany({ where: { orderId: dummyOrder.id } });
    await prisma.orderStatusHistory.deleteMany({ where: { orderId: dummyOrder.id } });
    await prisma.order.delete({ where: { id: dummyOrder.id } });
    console.log("✓ Removed dummy order #ORD-2501 and its items");
  } else {
    console.log("- No dummy order #ORD-2501 found");
  }

  // 2. Remove hardcoded dummy chat room
  const dummyChat = await prisma.chatRoom.findUnique({
    where: { whatsappPhone: "94761529557" },
    select: { id: true },
  });

  if (dummyChat) {
    await prisma.chatMessage.deleteMany({ where: { chatRoomId: dummyChat.id } });
    await prisma.chatRoom.delete({ where: { id: dummyChat.id } });
    console.log("✓ Removed dummy chat room & messages (94761529557)");
  } else {
    console.log("- No dummy chat room found");
  }

  // 3. Remove hardcoded dummy lead
  const deletedLeads = await prisma.lead.deleteMany({
    where: {
      OR: [
        { customerName: "Osii Studio" },
        { phone: "94782957542" },
      ],
    },
  });
  if (deletedLeads.count > 0) {
    console.log(`✓ Removed ${deletedLeads.count} dummy lead(s)`);
  }

  // 4. Remove hardcoded dummy customer
  const dummyCustomer = await prisma.customer.findUnique({
    where: { phone: "94761529557" },
    select: { id: true },
  });

  if (dummyCustomer) {
    await prisma.customer.delete({ where: { id: dummyCustomer.id } });
    console.log("✓ Removed dummy customer Dinuka Perera (94761529557)");
  } else {
    console.log("- No dummy customer Dinuka Perera found");
  }

  // 5. Remove hardcoded dummy cash flow transaction
  const deletedTxns = await prisma.cashFlowTransaction.deleteMany({
    where: { transactionCode: "TXN-9001" },
  });
  if (deletedTxns.count > 0) {
    console.log(`✓ Removed dummy transaction TXN-9001`);
  }

  // 6. Update old hardcoded staff names to clean role names
  await prisma.user.updateMany({
    where: { email: "admin@truehive.lk", name: { contains: "Dinusha" } },
    data: { name: process.env.ADMIN_NAME || "Super Admin" },
  });

  await prisma.user.updateMany({
    where: { email: "manager@truehive.lk", name: { contains: "Ruwan" } },
    data: { name: "Store Manager" },
  });

  await prisma.user.updateMany({
    where: { email: "cashier@truehive.lk", name: { contains: "Kasun" } },
    data: { name: "POS Cashier" },
  });

  await prisma.user.updateMany({
    where: { email: "agent@truehive.lk", name: { contains: "Nadeesha" } },
    data: { name: "WhatsApp Support Agent" },
  });
  console.log("✓ Cleaned staff user names to standard role titles");

  console.log("Cleanup completed successfully! All hardcoded dummy test data removed.");
}

cleanDummyData()
  .catch((e) => {
    console.error("Cleanup error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

