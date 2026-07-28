const { Resend } = require("resend");

function getClient() {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

async function sendLowStockAlert(products) {
  if (!products || products.length === 0) {
    return { sent: false, reason: "nothing_low" };
  }

  const client = getClient();
  if (!client) {
    console.warn("RESEND_API_KEY not set; skipping low-stock alert email");
    return { sent: false, reason: "not_configured" };
  }

  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    console.warn("ALERT_EMAIL_TO not set; skipping low-stock alert email");
    return { sent: false, reason: "no_recipient" };
  }

  const rows = products
    .map(
      (p) =>
        `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.quantity}</td><td>${p.reorderLevel}</td></tr>`
    )
    .join("");

  await client.emails.send({
    from: process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev",
    to,
    subject: `Low stock alert: ${products.length} product(s) need attention`,
    html:
      "<p>The following products are at or below their reorder level:</p>" +
      "<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\">" +
      "<tr><th>SKU</th><th>Name</th><th>Quantity</th><th>Reorder level</th></tr>" +
      rows +
      "</table>",
  });

  return { sent: true };
}

async function sendDailySummary({ totalProducts, totalQuantity, lowStockProducts }) {
  const client = getClient();
  if (!client) {
    console.warn("RESEND_API_KEY not set; skipping daily summary email");
    return { sent: false, reason: "not_configured" };
  }

  const to = process.env.ALERT_EMAIL_TO;
  if (!to) {
    console.warn("ALERT_EMAIL_TO not set; skipping daily summary email");
    return { sent: false, reason: "no_recipient" };
  }

  const lowStockRows = lowStockProducts
    .map((p) => `<tr><td>${p.sku}</td><td>${p.name}</td><td>${p.quantity}</td><td>${p.reorderLevel}</td></tr>`)
    .join("");

  await client.emails.send({
    from: process.env.ALERT_EMAIL_FROM || "onboarding@resend.dev",
    to,
    subject: `Daily inventory summary: ${totalProducts} products, ${lowStockProducts.length} low on stock`,
    html:
      `<p>Total products: <strong>${totalProducts}</strong></p>` +
      `<p>Total units in stock: <strong>${totalQuantity}</strong></p>` +
      (lowStockProducts.length > 0
        ? "<p>Low on stock:</p>" +
          "<table border=\"1\" cellpadding=\"4\" cellspacing=\"0\">" +
          "<tr><th>SKU</th><th>Name</th><th>Quantity</th><th>Reorder level</th></tr>" +
          lowStockRows +
          "</table>"
        : "<p>Nothing is low on stock right now.</p>"),
  });

  return { sent: true };
}

module.exports = { sendLowStockAlert, sendDailySummary };
