require("dotenv/config");
const bcrypt = require("bcryptjs");

const prisma = require("./client");
const { applyStockMovement } = require("../src/lib/stock");

const INITIAL_STOCK_QTY = 100;

const LOCATIONS = [
  {
    name: "สาขาสยาม",
    address: "989 ถ.พระราม 1 แขวงวังใหม่ เขตปทุมวัน กรุงเทพฯ",
    phone: "02-111-2222",
  },
  {
    name: "สาขาทองหล่อ",
    address: "55 ถ.สุขุมวิท 55 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ",
    phone: "02-333-4444",
  },
];

const SIZE_MODIFIER = {
  name: "ไซส์",
  selectionType: "single",
  required: true,
  options: [
    { name: "ปกติ", priceDelta: 0 },
    { name: "ใหญ่ (Large)", priceDelta: 15 },
  ],
};

const PRODUCTS = [
  {
    sku: "BURGER-CLASSIC",
    name: "เบอร์เกอร์คลาสสิก",
    unit: "ชิ้น",
    category: "เบอร์เกอร์",
    unitCost: 35,
    sellingPrice: 79,
    modifierGroups: [
      SIZE_MODIFIER,
      {
        name: "ท็อปปิ้งเพิ่ม",
        selectionType: "multiple",
        required: false,
        options: [
          { name: "ชีสเพิ่ม", priceDelta: 10 },
          { name: "เบคอน", priceDelta: 15 },
          { name: "ไข่ดาว", priceDelta: 10 },
        ],
      },
    ],
  },
  {
    sku: "BURGER-CHEESE",
    name: "ชีสเบอร์เกอร์",
    unit: "ชิ้น",
    category: "เบอร์เกอร์",
    unitCost: 40,
    sellingPrice: 89,
    modifierGroups: [
      SIZE_MODIFIER,
      {
        name: "ท็อปปิ้งเพิ่ม",
        selectionType: "multiple",
        required: false,
        options: [
          { name: "ชีสเพิ่ม", priceDelta: 10 },
          { name: "เบคอน", priceDelta: 15 },
        ],
      },
    ],
  },
  {
    sku: "FRIES-REG",
    name: "เฟรนช์ฟราย",
    unit: "ที่",
    category: "ของทานเล่น",
    unitCost: 15,
    sellingPrice: 39,
    modifierGroups: [SIZE_MODIFIER],
  },
  {
    sku: "DRINK-COLA",
    name: "น้ำอัดลม",
    unit: "แก้ว",
    category: "เครื่องดื่ม",
    unitCost: 8,
    sellingPrice: 25,
    modifierGroups: [
      {
        name: "ไซส์",
        selectionType: "single",
        required: false,
        options: [
          { name: "เล็ก", priceDelta: 0 },
          { name: "กลาง", priceDelta: 10 },
          { name: "ใหญ่", priceDelta: 15 },
        ],
      },
    ],
  },
  {
    sku: "DRINK-WATER",
    name: "น้ำเปล่า",
    unit: "ขวด",
    category: "เครื่องดื่ม",
    unitCost: 5,
    sellingPrice: 15,
    modifierGroups: [],
  },
];

async function getOrCreateAdmin() {
  const existingAdmin = await prisma.user.findFirst({ where: { role: "admin" } });
  if (existingAdmin) return existingAdmin;

  const email = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD || "changeme123";
  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await prisma.user.create({ data: { email, passwordHash, role: "admin" } });
  console.log(`Seeded admin user: ${email}`);
  return admin;
}

async function seedLocations() {
  const locations = [];
  for (const data of LOCATIONS) {
    const location = await prisma.location.upsert({
      where: { name: data.name },
      update: { address: data.address, phone: data.phone, isActive: true },
      create: { ...data, isActive: true },
    });
    locations.push(location);
    console.log(`Location ready: ${location.name}`);
  }
  return locations;
}

async function seedProduct(data, adminId) {
  const product = await prisma.product.upsert({
    where: { sku: data.sku },
    update: {
      name: data.name,
      unit: data.unit,
      category: data.category,
      unitCost: data.unitCost,
      sellingPrice: data.sellingPrice,
    },
    create: {
      sku: data.sku,
      name: data.name,
      unit: data.unit,
      category: data.category,
      unitCost: data.unitCost,
      sellingPrice: data.sellingPrice,
      createdById: adminId,
    },
  });

  for (const group of data.modifierGroups) {
    let modifierGroup = await prisma.modifierGroup.findFirst({
      where: { productId: product.id, name: group.name },
    });
    if (!modifierGroup) {
      modifierGroup = await prisma.modifierGroup.create({
        data: {
          productId: product.id,
          name: group.name,
          selectionType: group.selectionType,
          required: group.required,
        },
      });
    }

    for (const option of group.options) {
      const existingOption = await prisma.modifierOption.findFirst({
        where: { modifierGroupId: modifierGroup.id, name: option.name },
      });
      if (!existingOption) {
        await prisma.modifierOption.create({
          data: { modifierGroupId: modifierGroup.id, name: option.name, priceDelta: option.priceDelta },
        });
      }
    }
  }

  console.log(`Product ready: ${product.name} (${product.sku})`);
  return product;
}

async function stockProductAtLocation(product, location, adminId) {
  const existing = await prisma.locationStock.findUnique({
    where: { productId_locationId: { productId: product.id, locationId: location.id } },
  });
  if (existing && existing.quantity > 0) {
    console.log(`  ${location.name}: already stocked (${existing.quantity}), skipping`);
    return;
  }

  await prisma.$transaction((tx) =>
    applyStockMovement(tx, {
      productId: product.id,
      locationId: location.id,
      type: "in",
      quantity: INITIAL_STOCK_QTY,
      note: "Initial stock (seed-menu)",
      createdById: adminId,
    })
  );
  console.log(`  ${location.name}: stocked +${INITIAL_STOCK_QTY}`);
}

async function main() {
  const admin = await getOrCreateAdmin();
  const locations = await seedLocations();

  for (const data of PRODUCTS) {
    const product = await seedProduct(data, admin.id);
    for (const location of locations) {
      await stockProductAtLocation(product, location, admin.id);
    }
  }

  console.log("\nMenu seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
