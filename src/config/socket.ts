import { Server } from "socket.io";

let io: Server;

export const setSocketIO = (socketIO: Server) => {
  io = socketIO;
};

export const getSocketIO = () => {
  if (!io) {
    throw new Error("Socket.IO has not been initialized");
  }

  return io;
};
