export const BACKEND_URL = "http://localhost:4000";

async function request(path, options = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "something went wrong");
  }
  return data;
}

export function register(username, password) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function login(username, password) {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function getConversation(token, withUsername) {
  return request(`/api/messages/with/${encodeURIComponent(withUsername)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function sendMessage(token, to, content, type = "text", replyToId = null) {
  return request("/api/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to, content, type, replyToId }),
  });
}

export function updateAvatar(token, avatar) {
  return request("/api/users/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ avatar }),
  });
}

export function updateTheme(token, theme) {
  return request("/api/users/me", {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ theme }),
  });
}

export function searchGifs(token, query) {
  return request(`/api/gifs/search?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function createGroup(token, name) {
  return request("/api/groups", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
}

export function listGroups(token) {
  return request("/api/groups", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getGroup(token, groupId) {
  return request(`/api/groups/${groupId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function sendGroupMessage(token, groupId, content, type = "text", replyToId = null) {
  return request(`/api/groups/${groupId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content, type, replyToId }),
  });
}

export function addGroupMember(token, groupId, username) {
  return request(`/api/groups/${groupId}/members`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ username }),
  });
}

export function removeGroupMember(token, groupId, username) {
  return request(`/api/groups/${groupId}/members/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

// File uploads need FormData, not JSON — deliberately bypasses the
// request() helper above since it forces a JSON Content-Type header,
// which would break the multipart boundary the browser needs to set.
export async function uploadPost(token, file, caption) {
  const formData = new FormData();
  formData.append("file", file);
  if (caption) formData.append("caption", caption);

  const res = await fetch(`${BACKEND_URL}/api/profile/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "upload failed");
  return data;
}

export function getUserPosts(token, username) {
  return request(`/api/profile/${encodeURIComponent(username)}/posts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function toggleLike(token, postId) {
  return request(`/api/profile/posts/${postId}/like`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getComments(token, postId) {
  return request(`/api/profile/posts/${postId}/comments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function addComment(token, postId, content) {
  return request(`/api/profile/posts/${postId}/comments`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

export function deletePost(token, postId) {
  return request(`/api/profile/posts/${postId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function getServerTime() {
  const res = await fetch(`${BACKEND_URL}/api/time`);
  return res.json();
}

export async function uploadGroupTrack(token, groupId, file, title) {
  const formData = new FormData();
  formData.append("file", file);
  if (title) formData.append("title", title);
  const res = await fetch(`${BACKEND_URL}/api/groups/${groupId}/audio-tracks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "upload failed");
  return data;
}

export function listGroupTracks(token, groupId) {
  return request(`/api/groups/${groupId}/audio-tracks`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function deleteGroupTrack(token, groupId, trackId) {
  return request(`/api/groups/${groupId}/audio-tracks/${trackId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getPlaybackState(token, groupId) {
  return request(`/api/groups/${groupId}/playback`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function playTrack(token, groupId, trackId, positionMs = 0) {
  return request(`/api/groups/${groupId}/playback/play`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ trackId, positionMs }),
  });
}

export function pausePlayback(token, groupId) {
  return request(`/api/groups/${groupId}/playback/pause`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function seekPlayback(token, groupId, positionMs) {
  return request(`/api/groups/${groupId}/playback/seek`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ positionMs }),
  });
}

export function stopPlayback(token, groupId) {
  return request(`/api/groups/${groupId}/playback/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function getConversations(token) {
  return request("/api/conversations", {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function markDmRead(token, username) {
  return request(`/api/messages/with/${encodeURIComponent(username)}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function markGroupRead(token, groupId) {
  return request(`/api/groups/${groupId}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function editMessage(token, messageId, content) {
  return request(`/api/messages/${messageId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

export function deleteMessage(token, messageId, mode = "me") {
  return request(`/api/messages/${messageId}?mode=${mode}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function editGroupMessage(token, groupId, messageId, content) {
  return request(`/api/groups/${groupId}/messages/${messageId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
}

export function deleteGroupMessage(token, groupId, messageId, mode = "me") {
  return request(`/api/groups/${groupId}/messages/${messageId}?mode=${mode}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function reactToMessage(token, messageId, emoji) {
  return request(`/api/messages/${messageId}/reactions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emoji }),
  });
}

export function reactToGroupMessage(token, groupId, messageId, emoji) {
  return request(`/api/groups/${groupId}/messages/${messageId}/reactions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ emoji }),
  });
}

export function changeGroupMemberRole(token, groupId, username, role) {
  return request(`/api/groups/${groupId}/members/${encodeURIComponent(username)}/role`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  });
}

export function forwardMessage(token, messageId, target) {
  return request(`/api/messages/${messageId}/forward`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(target),
  });
}

export function forwardGroupMessage(token, groupId, messageId, target) {
  return request(`/api/groups/${groupId}/messages/${messageId}/forward`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(target),
  });
}

export function pinMessage(token, messageId) {
  return request(`/api/messages/${messageId}/pin`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
export function unpinMessage(token, messageId) {
  return request(`/api/messages/${messageId}/unpin`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
export function pinGroupMessage(token, groupId, messageId) {
  return request(`/api/groups/${groupId}/messages/${messageId}/pin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
export function unpinGroupMessage(token, groupId, messageId) {
  return request(`/api/groups/${groupId}/messages/${messageId}/unpin`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function starMessage(token, messageId) {
  return request(`/api/messages/${messageId}/star`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
}
export function starGroupMessage(token, groupId, messageId) {
  return request(`/api/groups/${groupId}/messages/${messageId}/star`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
}
export function getStarredMessages(token) {
  return request("/api/starred-messages", { headers: { Authorization: `Bearer ${token}` } });
}

export async function sendVoiceMessage(token, toUsername, blob, durationSeconds, replyToId) {
  const formData = new FormData();
  formData.append("file", blob, "voice.webm");
  formData.append("to", toUsername);
  formData.append("durationSeconds", String(durationSeconds));
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/messages/voice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send voice message");
  return data;
}

export async function sendGroupVoiceMessage(token, groupId, blob, durationSeconds, replyToId) {
  const formData = new FormData();
  formData.append("file", blob, "voice.webm");
  formData.append("durationSeconds", String(durationSeconds));
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/groups/${groupId}/messages/voice`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send voice message");
  return data;
}

export async function sendVideoNote(token, toUsername, blob, durationSeconds, replyToId) {
  const formData = new FormData();
  formData.append("file", blob, "note.webm");
  formData.append("to", toUsername);
  formData.append("durationSeconds", String(durationSeconds));
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/messages/video-note`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send video note");
  return data;
}

export async function sendGroupVideoNote(token, groupId, blob, durationSeconds, replyToId) {
  const formData = new FormData();
  formData.append("file", blob, "note.webm");
  formData.append("durationSeconds", String(durationSeconds));
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/groups/${groupId}/messages/video-note`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send video note");
  return data;
}

// Document/file sharing. `file` is usually a real File object from an
// <input type="file">, whose name/type ride along automatically — but when
// the image compression pipeline runs, it produces a plain Blob (canvas
// output has no filename), so an explicit `fileName` override is supported.
export async function sendFileMessage(token, toUsername, file, replyToId, fileName) {
  const formData = new FormData();
  formData.append("file", file, fileName || file.name);
  formData.append("to", toUsername);
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/messages/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send that file");
  return data;
}

export async function sendGroupFileMessage(token, groupId, file, replyToId, fileName) {
  const formData = new FormData();
  formData.append("file", file, fileName || file.name);
  if (replyToId) formData.append("replyToId", String(replyToId));

  const res = await fetch(`${BACKEND_URL}/api/groups/${groupId}/messages/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "couldn't send that file");
  return data;
}

// Mute a chat. `durationHours` omitted/null mutes indefinitely (until
// explicitly unmuted); otherwise it auto-expires after that many hours.
export function muteDm(token, username, durationHours = null) {
  return request(`/api/mutes/dm/${encodeURIComponent(username)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ durationHours }),
  });
}

export function unmuteDm(token, username) {
  return request(`/api/mutes/dm/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

export function muteGroup(token, groupId, durationHours = null) {
  return request(`/api/mutes/group/${groupId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ durationHours }),
  });
}

export function unmuteGroup(token, groupId) {
  return request(`/api/mutes/group/${groupId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}
