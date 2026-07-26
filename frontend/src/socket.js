import { io } from "socket.io-client";

const BACKEND_URL = "http://localhost:4000";

export function connectSocket(token) {
  return io(BACKEND_URL, {
    auth: { token },
  });
}
