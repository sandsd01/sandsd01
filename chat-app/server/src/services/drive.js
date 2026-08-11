const { driveClientFromAccessToken } = require("./googleAuth");

const APP_FOLDER_NAME = "ChatApp_ChatData";
const CONVERSATIONS_SUBFOLDER = "conversations";
const ATTACHMENTS_SUBFOLDER = "attachments";

function escapeForQuery(value) {
  return value.replace(/'/g, "\\'");
}

async function findOrCreateFolder(drive, name, parentId) {
  const parentClause = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
  const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapeForQuery(
    name
  )}' and trashed = false${parentClause}`;
  const { data } = await drive.files.list({ q, fields: "files(id, name)", spaces: "drive" });
  if (data.files && data.files.length > 0) return data.files[0].id;

  const { data: created } = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  return created.id;
}

// Called once at first login (see routes/auth.js) to lay out the
// AppName_ChatData/{conversations,attachments} structure from spec section 5.
async function ensureAppFolders(accessToken) {
  const drive = driveClientFromAccessToken(accessToken);
  const rootFolderId = await findOrCreateFolder(drive, APP_FOLDER_NAME);
  await findOrCreateFolder(drive, CONVERSATIONS_SUBFOLDER, rootFolderId);
  await findOrCreateFolder(drive, ATTACHMENTS_SUBFOLDER, rootFolderId);
  return rootFolderId;
}

async function getSubfolderId(accessToken, rootFolderId, subfolderName) {
  const drive = driveClientFromAccessToken(accessToken);
  return findOrCreateFolder(drive, subfolderName, rootFolderId);
}

async function findTranscriptFile(drive, conversationsFolderId, conversationId) {
  const fileName = `conv_${conversationId}.json`;
  const q = `name = '${fileName}' and '${conversationsFolderId}' in parents and trashed = false`;
  const { data } = await drive.files.list({ q, fields: "files(id, name)", spaces: "drive" });
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function readTranscript(drive, fileId) {
  const { data } = await drive.files.get({ fileId, alt: "media" });
  return typeof data === "string" ? JSON.parse(data) : data;
}

async function writeTranscript(drive, fileId, folderId, fileName, transcript) {
  const media = { mimeType: "application/json", body: JSON.stringify(transcript, null, 2) };
  if (fileId) {
    await drive.files.update({ fileId, media });
    return fileId;
  }
  const { data } = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId], mimeType: "application/json" },
    media,
    fields: "id",
  });
  return data.id;
}

// Appends one message to conv_<id>.json in this user's own Drive, creating
// the file on first write. Returns the Drive file id so the caller can save
// it on conversations.user_a/b_drive_file_id for fast lookup later.
async function appendMessageToTranscript({ accessToken, rootFolderId, conversationId, participants, message }) {
  const drive = driveClientFromAccessToken(accessToken);
  const conversationsFolderId = await getSubfolderId(accessToken, rootFolderId, CONVERSATIONS_SUBFOLDER);
  const fileName = `conv_${conversationId}.json`;
  const existingFileId = await findTranscriptFile(drive, conversationsFolderId, conversationId);

  const transcript = existingFileId
    ? await readTranscript(drive, existingFileId)
    : { conversationId, participants, messages: [] };
  transcript.messages.push(message);

  return writeTranscript(drive, existingFileId, conversationsFolderId, fileName, transcript);
}

async function shareFileReadOnly(accessToken, fileId, email) {
  const drive = driveClientFromAccessToken(accessToken);
  await drive.permissions.create({
    fileId,
    sendNotificationEmail: false,
    requestBody: { role: "reader", type: "user", emailAddress: email },
  });
}

module.exports = {
  APP_FOLDER_NAME,
  CONVERSATIONS_SUBFOLDER,
  ATTACHMENTS_SUBFOLDER,
  ensureAppFolders,
  getSubfolderId,
  appendMessageToTranscript,
  shareFileReadOnly,
};
