require("dotenv/config");
const app = require("./app");

const port = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.error("JWT_SECRET environment variable is required");
  process.exit(1);
}

app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});
