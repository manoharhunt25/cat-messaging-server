require("./config/nodeCompat"); // must stay first: lets jsonwebtoken load on Node 25+
const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const connectDB = require("./config/db");
// Resolve relative to this file so the server works from any working directory
require("dotenv").config({ path: path.join(__dirname, "config", ".enviro") });
const colors = require("colors");
const userRoutes = require("./Routes/userRoutes");
const chatRoutes = require("./Routes/chatRoutes");
const messageRoutes = require("./Routes/messageRoutes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("./models/userModel");
const Chat = require("./models/chatModel");
const Message = require("./models/messageModel");

const app = express();
dotenv.config();
connectDB();
app.use(express.json()); //to accept json from frontend
app.use(cors());

app.get("/", (req, res) => {
  res.send("API running successfully");
});

app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/message", messageRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () =>
  console.log(`Server started on port ${PORT}`.yellow.bold)
);

const io = require("socket.io")(server, {
  pingTimeout: 60000,
  cors: {
    origin: "http://localhost:3000",
  },
});

// Every socket must present the same JWT the REST API uses:
//   io(url, { auth: { token } })
// The verified user id is stored on the socket and used for everything below,
// so a client can't act as, or listen in on, another user.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.exists({ _id: id });
    if (!user) throw new Error("user not found");
    socket.userId = String(id);
    next();
  } catch {
    next(new Error("Not authorized"));
  }
});

io.on("connection", (socket) => {
  // Each user listens on a private room named after their own (verified) id.
  // The payload is ignored on purpose.
  socket.on("setup", () => {
    socket.join(socket.userId);
    socket.emit("connected");
  });

  // Only members may join a chat's room
  socket.on("join chat", async (chatId) => {
    try {
      if (!mongoose.isValidObjectId(chatId)) return;
      const isMember = await Chat.exists({ _id: chatId, users: socket.userId });
      if (isMember) socket.join(String(chatId));
    } catch (error) {
      console.error("join chat failed:", error.message);
    }
  });

  // Relay a message the client has just saved via POST /api/message.
  // The payload is not trusted: the message is reloaded from the database,
  // must have been sent by this socket's user, and is delivered only to
  // that chat's real members.
  socket.on("new message", async (payload) => {
    try {
      const messageId = payload && payload._id;
      if (!mongoose.isValidObjectId(messageId)) return;

      const message = await Message.findById(messageId)
        .populate("sender", "name pic email")
        .populate({ path: "chat", populate: { path: "users", select: "name pic email" } });

      if (!message || !message.chat) return;
      if (String(message.sender._id) !== socket.userId) return;

      message.chat.users.forEach((member) => {
        const memberId = String(member._id);
        if (memberId === socket.userId) return;
        socket.in(memberId).emit("message recieved", message);
      });
    } catch (error) {
      console.error("new message relay failed:", error.message);
    }
  });
});
