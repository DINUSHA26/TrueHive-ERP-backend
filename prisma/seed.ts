import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding TrueHive CRM & ERP base tables into Supabase...");

  // Admin credentials from environment variables or secure defaults
  const adminEmail = process.env.ADMIN_EMAIL || "admin@truehive.lk";
  const adminName = process.env.ADMIN_NAME || "Super Admin";
  const adminPhone = process.env.ADMIN_PHONE || "+94770000000";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin123";
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  // 1. Seed Staff Users across core Roles
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      phone: adminPhone,
    },
    create: {
      name: adminName,
      email: adminEmail,
      phone: adminPhone,
      passwordHash,
      role: "SUPER_ADMIN",
      permissions: ["ALL"],
    },
  });

  await prisma.user.upsert({
    where: { email: "manager@truehive.lk" },
    update: {
      name: "Store Manager",
    },
    create: {
      name: "Store Manager",
      email: "manager@truehive.lk",
      phone: "+94772221111",
      passwordHash,
      role: "MANAGER",
      permissions: ["DASHBOARD", "POS", "ORDERS", "INGREDIENTS_BOM", "LEADS_CRM"],
    },
  });

  await prisma.user.upsert({
    where: { email: "cashier@truehive.lk" },
    update: {
      name: "POS Cashier",
    },
    create: {
      name: "POS Cashier",
      email: "cashier@truehive.lk",
      phone: "+94772223334",
      passwordHash,
      role: "CASHIER_POS",
      permissions: ["POS", "ORDERS", "PRODUCTS"],
    },
  });

  const agent = await prisma.user.upsert({
    where: { email: "agent@truehive.lk" },
    update: {
      name: "WhatsApp Support Agent",
    },
    create: {
      name: "WhatsApp Support Agent",
      email: "agent@truehive.lk",
      phone: "+94718889990",
      passwordHash,
      role: "SUPPORT_AGENT",
      permissions: ["CHATS", "LEADS", "ORDERS"],
    },
  });

  // 2. Seed Base Suppliers (idempotent)
  let sup1 = await prisma.supplier.findFirst({
    where: { name: "Ceylon Agro Mills (Pvt) Ltd" },
  });
  if (!sup1) {
    sup1 = await prisma.supplier.create({
      data: {
        name: "Ceylon Agro Mills (Pvt) Ltd",
        contactPerson: "Roshan Perera",
        phone: "+94112345678",
        email: "orders@ceylonagro.lk",
        address: "Colombo 14",
        creditBalance: 0,
      },
    });
  }

  let sup2 = await prisma.supplier.findFirst({
    where: { name: "Lanka Food Imports" },
  });
  if (!sup2) {
    sup2 = await prisma.supplier.create({
      data: {
        name: "Lanka Food Imports",
        contactPerson: "Shiranthi Fernando",
        phone: "+94114567890",
        email: "supply@lankafoods.lk",
        address: "Peliyagoda",
        creditBalance: 0,
      },
    });
  }

  // 3. Seed Base Raw Ingredients (for BOM recipes)
  const ingFlour = await prisma.ingredient.upsert({
    where: { sku: "ING-FLR-01" },
    update: {},
    create: {
      name: "Premium Prima Flour",
      sku: "ING-FLR-01",
      barcode: "8901001001",
      unit: "kg",
      currentStock: 85.5,
      reorderLevel: 20,
      unitCost: 290,
      supplierId: sup1.id,
    },
  });

  const ingCocoa = await prisma.ingredient.upsert({
    where: { sku: "ING-COC-02" },
    update: {},
    create: {
      name: "Belgian Dark Cocoa Powder",
      sku: "ING-COC-02",
      barcode: "8901001002",
      unit: "kg",
      currentStock: 14.2,
      reorderLevel: 15,
      unitCost: 3400,
      supplierId: sup2.id,
    },
  });

  const ingButter = await prisma.ingredient.upsert({
    where: { sku: "ING-BTR-03" },
    update: {},
    create: {
      name: "Anchor Unsalted Butter",
      sku: "ING-BTR-03",
      barcode: "8901001003",
      unit: "kg",
      currentStock: 32.0,
      reorderLevel: 10,
      unitCost: 2850,
      supplierId: sup2.id,
    },
  });

  // 4. Seed Category & Products with Barcodes & BOM
  const catBakery = await prisma.category.upsert({
    where: { slug: "cakes-bakery" },
    update: {},
    create: {
      name: "Cakes & Bakery",
      slug: "cakes-bakery",
    },
  });

  const prod1 = await prisma.product.upsert({
    where: { sku: "TH-CAKE-001" },
    update: {},
    create: {
      name: "Signature Belgian Chocolate Fudge Cake (1kg)",
      slug: "belgian-chocolate-fudge-cake-1kg",
      sku: "TH-CAKE-001",
      barcode: "479202600101",
      categoryId: catBakery.id,
      sellingPrice: 3850,
      calculatedCogs: 1485,
      currentStock: 18,
      reorderLevel: 5,
      unit: "pcs",
      trackBom: true,
    },
  });

  const prod2 = await prisma.product.upsert({
    where: { sku: "TH-BRW-003" },
    update: {},
    create: {
      name: "Assorted Artisan Brownie Box (12 Pcs)",
      slug: "assorted-artisan-brownie-box-12pcs",
      sku: "TH-BRW-003",
      barcode: "479202600103",
      categoryId: catBakery.id,
      sellingPrice: 2450,
      calculatedCogs: 940,
      currentStock: 31,
      reorderLevel: 8,
      unit: "pcs",
      trackBom: true,
    },
  });

  // Link BOM Recipes
  await prisma.productIngredientBOM.upsert({
    where: {
      productId_ingredientId: {
        productId: prod1.id,
        ingredientId: ingFlour.id,
      },
    },
    update: {},
    create: {
      productId: prod1.id,
      ingredientId: ingFlour.id,
      quantityRequired: 0.35,
    },
  });

  await prisma.productIngredientBOM.upsert({
    where: {
      productId_ingredientId: {
        productId: prod1.id,
        ingredientId: ingCocoa.id,
      },
    },
    update: {},
    create: {
      productId: prod1.id,
      ingredientId: ingCocoa.id,
      quantityRequired: 0.15,
    },
  });

  await prisma.productIngredientBOM.upsert({
    where: {
      productId_ingredientId: {
        productId: prod1.id,
        ingredientId: ingButter.id,
      },
    },
    update: {},
    create: {
      productId: prod1.id,
      ingredientId: ingButter.id,
      quantityRequired: 0.22,
    },
  });

  // 5. Ensure Financial Account exists for POS
  let cashAcc = await prisma.financialAccount.findFirst({
    where: { type: "CASH_DRAWER" },
  });
  if (!cashAcc) {
    cashAcc = await prisma.financialAccount.create({
      data: {
        name: "Main POS Cash Drawer",
        type: "CASH_DRAWER",
        balance: 0,
      },
    });
  }

  // 6. Clean up hardcoded dummy records from database
  try {
    const dummyOrder = await prisma.order.findUnique({
      where: { orderNumber: "#ORD-2501" },
      select: { id: true },
    });
    if (dummyOrder) {
      await prisma.orderItem.deleteMany({ where: { orderId: dummyOrder.id } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: dummyOrder.id } });
      await prisma.order.delete({ where: { id: dummyOrder.id } });
      console.log("✓ Removed hardcoded dummy order #ORD-2501");
    }

    const dummyChat = await prisma.chatRoom.findUnique({
      where: { whatsappPhone: "94761529557" },
      select: { id: true },
    });
    if (dummyChat) {
      await prisma.chatMessage.deleteMany({ where: { chatRoomId: dummyChat.id } });
      await prisma.chatRoom.delete({ where: { id: dummyChat.id } });
      console.log("✓ Removed hardcoded dummy chat room (94761529557)");
    }

    await prisma.lead.deleteMany({
      where: {
        OR: [
          { customerName: "Osii Studio" },
          { phone: "94782957542" },
        ],
      },
    });

    const dummyCustomer = await prisma.customer.findUnique({
      where: { phone: "94761529557" },
      select: { id: true },
    });
    if (dummyCustomer) {
      await prisma.customer.delete({ where: { id: dummyCustomer.id } });
      console.log("✓ Removed hardcoded dummy customer (94761529557)");
    }

    await prisma.cashFlowTransaction.deleteMany({
      where: { transactionCode: "TXN-9001" },
    });
  } catch (cleanErr) {
    console.warn("Notice: Dummy data cleanup notice:", cleanErr);
  }

  console.log("✓ TrueHive seed completed cleanly! Admin account:", admin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
