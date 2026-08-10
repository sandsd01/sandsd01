require("dotenv/config");
const cron = require("node-cron");
const app = require("./app");
const { sendLowStockAlert, sendDailySummary } = require("./lib/email");
const { getSummary } = require("./routes/reports");

const port = process.env.PORT || 3000;

// A guessable signing key means anyone can mint an admin token, so refuse to
// boot on a missing, placeholder, or too-short secret rather than starting up
// in a state that looks healthy but isn't.
const PLACEHOLDER_SECRETS = new Set(["replace-with-a-long-random-secret", "changeme", "secret"]);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  console.error("JWT_SECRET environment variable is required");
  process.exit(1);
}
if (PLACEHOLDER_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
  console.error(
    "JWT_SECRET must be a random value of at least 32 characters (the .env.example placeholder is not usable). " +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
  );
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
// (standard 5-field cron expression); defaults to 8am. Runs in CRON_TIMEZONE
// so a server in UTC still fires at 8am local shop time rather than mid-
// afternoon, and so "today's" figures line up with the shop's day.
// No-ops safely (see src/lib/email.js) if Resend isn't configured.
const cronTimezone = process.env.CRON_TIMEZONE || "Asia/Bangkok";
cron.schedule(
  process.env.DAILY_SUMMARY_CRON || "0 8 * * *",
  async () => {
    try {
      const summary = await getSummary();
      await sendDailySummary(summary);
    } catch (err) {
      console.error("Failed to send daily summary email:", err);
    }
  },
  { timezone: cronTimezone }
);

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
