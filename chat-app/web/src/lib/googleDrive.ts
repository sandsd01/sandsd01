// Uploads go straight from the browser to the user's own Google Drive using
// the short-lived access token from GET /me/drive-token — bytes never pass
// through our relay server. See spec section 7.
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";

interface DriveTokenInfo {
  accessToken: string;
  driveFolderId: string;
}

async function getAttachmentsFolderId(accessToken: string, rootFolderId: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType = 'application/vnd.google-apps.folder' and name = 'attachments' and '${rootFolderId}' in parents and trashed = false`
  );
  const res = await fetch(`${DRIVE_FILES_URL}?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (data.files?.length) return data.files[0].id;

  const createRes = await fetch(DRIVE_FILES_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "attachments",
      mimeType: "application/vnd.google-apps.folder",
      parents: [rootFolderId],
    }),
  });
  const created = await createRes.json();
  return created.id;
}

export async function uploadAttachment(
  file: File,
  { accessToken, driveFolderId }: DriveTokenInfo
): Promise<{ driveFileId: string; shareLink: string; fileName: string }> {
  const attachmentsFolderId = await getAttachmentsFolderId(accessToken, driveFolderId);

  const metadata = { name: `${crypto.randomUUID()}_${file.name}`, parents: [attachmentsFolderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);

  const res = await fetch(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status}`);
  }

  const data = await res.json();
  return { driveFileId: data.id, shareLink: data.webViewLink, fileName: file.name };
}
