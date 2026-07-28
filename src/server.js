require("dotenv/config");
const app = require("./app");
const { sendLowStockAlert } = require("./lib/email");

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

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
