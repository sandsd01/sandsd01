require("dotenv/config");
const cron = require("node-cron");
const app = require("./app");
const { sendLowStockAlert, sendDailySummary } = require("./lib/email");
const { getSummary } = require("./routes/reports");

const port = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET environment variable is required");
  process.exit(1);
}

// Fires only when a stock-out movement crosses a product from above its
// reorder level down to at-or-below it, so admins aren't emailed on every movement.
app.locals.onStockMovement = (updatedProduct, previousQuantity) => {
  if (updatedProduct.quantity <= updatedProduct.reorderLevel && previousQuantity > updatedProduct.reorderLevel) {
    sendLowStockAlert([updatedProduct]).catch((err) => {
      console.error("Failed to send low-stock alert email:", err);
    });
  }
};

// Daily inventory summary email. Configurable via DAILY_SUMMARY_CRON
// (standard 5-field cron expression, server local time); defaults to 8am daily.
// No-ops safely (see src/lib/email.js) if Resend isn't configured.
cron.schedule(process.env.DAILY_SUMMARY_CRON || "0 8 * * *", async () => {
  try {
    const summary = await getSummary();
    await sendDailySummary(summary);
  } catch (err) {
    console.error("Failed to send daily summary email:", err);
  }
});

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
