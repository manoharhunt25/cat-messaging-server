const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Message = require("../models/messageModel");
const User = require("../models/userModel");
const Chat = require("../models/chatModel");

// Makes sure the chat exists and the caller is one of its members.
const ensureMember = async (chatId, user, res) => {
  if (!mongoose.isValidObjectId(chatId)) {
    res.status(400);
    throw new Error("Invalid chat id");
  }
  const chat = await Chat.findById(chatId).select("users");
  if (!chat) {
    res.status(404);
    throw new Error("Chat Not Found");
  }
  if (!chat.users.some((u) => u.equals(user._id))) {
    res.status(403);
    throw new Error("You are not a member of this chat");
  }
};

// @desc    Get all messages in a chat (members only)
// @route   GET /api/message/:chatId
// @access  Protected
const allMessages = asyncHandler(async (req, res) => {
  await ensureMember(req.params.chatId, req.user, res);

  const messages = await Message.find({ chat: req.params.chatId })
    .populate("sender", "name pic email")
    .populate("chat");

  res.json(messages);
});

// @desc    Send a message to a chat (members only)
// @route   POST /api/message
// @access  Protected
const sendMessage = asyncHandler(async (req, res) => {
  // Older clients send the whole chat object; accept either form.
  const rawChatId = req.body.chatId;
  const chatId = rawChatId && rawChatId._id ? String(rawChatId._id) : rawChatId;
  const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

  if (!content || !chatId) {
    res.status(400);
    throw new Error("content and chatId are required");
  }

  await ensureMember(chatId, req.user, res);

  let message = await Message.create({
    sender: req.user._id,
    content,
    chat: chatId,
  });

  message = await message.populate("sender", "name pic");
  message = await message.populate("chat");
  message = await User.populate(message, {
    path: "chat.users",
    select: "name pic email",
  });

  await Chat.findByIdAndUpdate(chatId, { latestMessage: message });

  res.json(message);
});

module.exports = { sendMessage, allMessages };
