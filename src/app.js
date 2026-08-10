const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const userRoutes = require("./routes/users");
const reportRoutes = require("./routes/reports");
const supplierRoutes = require("./routes/suppliers");
const purchaseOrderRoutes = require("./routes/purchaseOrders");
const locationRoutes = require("./routes/locations");
const salesRoutes = require("./routes/sales");
const { uploadDir } = require("./lib/upload");
const { apiLimiter } = require("./middleware/rateLimit");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/uploads", express.static(uploadDir));

app.use(apiLimiter);

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/users", userRoutes);
app.use("/reports", reportRoutes);
app.use("/suppliers", supplierRoutes);
app.use("/purchase-orders", purchaseOrderRoutes);
app.use("/locations", locationRoutes);
app.use("/sales", salesRoutes);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
