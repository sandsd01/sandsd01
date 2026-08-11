const { google } = require("googleapis");

// drive.file (not the full "drive" scope) so the app can only ever see files
// it created itself — never the rest of the user's Drive. See spec section 3.
const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"];

function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl() {
  const client = createOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    // Forces Google to reissue a refresh_token even for a returning user who
    // already granted consent once — without this, a repeat consent can come
    // back with no refresh_token at all.
    prompt: "consent",
    scope: SCOPES,
  });
}

async function exchangeCodeForTokens(code) {
  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: profile } = await oauth2.userinfo.get();
  return { tokens, profile };
}

async function getFreshAccessToken(refreshToken) {
  const client = createOAuthClient();
  client.setCredentials({ refresh_token: refreshToken });
  const { credentials } = await client.refreshAccessToken();
  return credentials;
}

function driveClientFromAccessToken(accessToken) {
  const client = createOAuthClient();
  client.setCredentials({ access_token: accessToken });
  return google.drive({ version: "v3", auth: client });
}

module.exports = {
  SCOPES,
  createOAuthClient,
  getAuthUrl,
  exchangeCodeForTokens,
  getFreshAccessToken,
  driveClientFromAccessToken,
};
