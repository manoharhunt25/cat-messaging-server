const asyncHandler = require("express-async-handler");
const mongoose = require("mongoose");
const Chat = require("../models/chatModel");
const User = require("../models/userModel");

//@description     Create or fetch One to One Chat
//@route           POST /api/chat/
//@access          Protected
const accessChat = asyncHandler(async (req, res) => {
  const { userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("A valid userId is required");
  }
  if (req.user._id.equals(userId)) {
    res.status(400);
    throw new Error("You can't start a chat with yourself");
  }
  if (!(await User.exists({ _id: userId }))) {
    res.status(404);
    throw new Error("User not found");
  }

  var isChat = await Chat.find({
    isGroupChat: false,
    $and: [
      { users: { $elemMatch: { $eq: req.user._id } } },
      { users: { $elemMatch: { $eq: userId } } },
    ],
  })
    .populate("users", "-password")
    .populate("latestMessage");

  isChat = await User.populate(isChat, {
    path: "latestMessage.sender",
    select: "name pic email",
  });

  if (isChat.length > 0) {
    res.send(isChat[0]);
  } else {
    var chatData = {
      chatName: "sender",
      isGroupChat: false,
      users: [req.user._id, userId],
    };

    try {
      const createdChat = await Chat.create(chatData);
      const FullChat = await Chat.findOne({ _id: createdChat._id }).populate(
        "users",
        "-password"
      );
      res.status(200).send(FullChat);
    } catch (error) {
      res.status(400);
      throw new Error(error.message);
    }
  }
});
const fetchChats = asyncHandler(async (req, res) => {
  try {
    Chat.find({ users: { $elemMatch: { $eq: req.user._id } } })
      .populate("users", "-password")
      .populate("groupAdmin", "-password")
      .populate("latestMessage")
      .sort({ updatedAt: -1 })
      .then(async (results) => {
        results = await User.populate(results, {
          path: "latestMessage.sender",
          select: "name email",
        });
        res.status(200).send(results);
      });
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});

const createGroupChat = asyncHandler(async (req, res) => {
  if (!req.body.users || !req.body.name) {
    return res.status(400).send({ message: "Please Fill all the feilds" });
  }

  let users;
  try {
    users = JSON.parse(req.body.users);
  } catch {
    res.status(400);
    throw new Error("users must be a JSON array of user ids");
  }
  if (!Array.isArray(users) || !users.every((id) => mongoose.isValidObjectId(id))) {
    res.status(400);
    throw new Error("users must be a JSON array of user ids");
  }

  // Drop duplicates and the creator, who is added below as admin
  users = [...new Set(users.map(String))].filter(
    (id) => !req.user._id.equals(id)
  );

  if (users.length < 2) {
    return res
      .status(400)
      .send("More than 2 users are required to form a group chat");
  }
  if ((await User.countDocuments({ _id: { $in: users } })) !== users.length) {
    res.status(400);
    throw new Error("One or more users were not found");
  }

  users.push(req.user._id);

  try {
    const groupChat = await Chat.create({
      chatName: req.body.name,
      users: users,
      isGroupChat: true,
      groupAdmin: req.user,
    });

    const fullGroupChat = await Chat.findOne({ _id: groupChat._id })
      .populate("users", "-password")
      .populate("groupAdmin", "-password");

    res.status(200).json(fullGroupChat);
  } catch (error) {
    res.status(400);
    throw new Error(error.message);
  }
});
// Loads a group chat the caller belongs to, or responds with the right error.
const loadGroupForMember = async (chatId, user, res) => {
  if (!mongoose.isValidObjectId(chatId)) {
    res.status(400);
    throw new Error("Invalid chat id");
  }
  const chat = await Chat.findById(chatId);
  if (!chat) {
    res.status(404);
    throw new Error("Chat Not Found");
  }
  if (!chat.isGroupChat) {
    res.status(400);
    throw new Error("This is not a group chat");
  }
  if (!chat.users.some((u) => u.equals(user._id))) {
    res.status(403);
    throw new Error("You are not a member of this group");
  }
  return chat;
};

const isGroupAdmin = (chat, user) =>
  Boolean(chat.groupAdmin) && chat.groupAdmin.equals(user._id);

const populateGroup = (query) =>
  query.populate("users", "-password").populate("groupAdmin", "-password");

// @desc    Rename a group (admin only)
// @route   PUT /api/chat/rename
// @access  Protected
const renameGroup = asyncHandler(async (req, res) => {
  const { chatId } = req.body;
  const chatName = (req.body.chatName || "").trim();

  if (!chatName) {
    res.status(400);
    throw new Error("Group name is required");
  }

  const chat = await loadGroupForMember(chatId, req.user, res);
  if (!isGroupAdmin(chat, req.user)) {
    res.status(403);
    throw new Error("Only the group admin can rename the group");
  }

  const updatedChat = await populateGroup(
    Chat.findByIdAndUpdate(chatId, { chatName }, { new: true })
  );
  res.json(updatedChat);
});

// @desc    Remove a user from a group. The admin can remove anyone;
//          any member can remove themselves (leave the group).
// @route   PUT /api/chat/groupremove
// @access  Protected
const removeFromGroup = asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("Invalid user id");
  }

  const chat = await loadGroupForMember(chatId, req.user, res);
  const leaving = req.user._id.equals(userId);

  if (!leaving && !isGroupAdmin(chat, req.user)) {
    res.status(403);
    throw new Error("Only the group admin can remove members");
  }
  if (!chat.users.some((u) => u.equals(userId))) {
    res.status(400);
    throw new Error("That user is not in this group");
  }

  const update = { $pull: { users: userId } };

  // If the admin leaves, hand the role to the next remaining member so the
  // group is never left without an admin.
  if (chat.groupAdmin && chat.groupAdmin.equals(userId)) {
    const next = chat.users.find((u) => !u.equals(userId));
    update.$set = { groupAdmin: next || null };
  }

  const removed = await populateGroup(
    Chat.findByIdAndUpdate(chatId, update, { new: true })
  );
  res.json(removed);
});

// @desc    Add a user to a group (admin only)
// @route   PUT /api/chat/groupadd
// @access  Protected
const addToGroup = asyncHandler(async (req, res) => {
  const { chatId, userId } = req.body;

  if (!mongoose.isValidObjectId(userId)) {
    res.status(400);
    throw new Error("Invalid user id");
  }

  const chat = await loadGroupForMember(chatId, req.user, res);
  if (!isGroupAdmin(chat, req.user)) {
    res.status(403);
    throw new Error("Only the group admin can add members");
  }
  if (chat.users.some((u) => u.equals(userId))) {
    res.status(400);
    throw new Error("User already in group");
  }
  if (!(await User.exists({ _id: userId }))) {
    res.status(404);
    throw new Error("User not found");
  }

  const added = await populateGroup(
    Chat.findByIdAndUpdate(
      chatId,
      { $addToSet: { users: userId } },
      { new: true }
    )
  );
  res.json(added);
});

module.exports = {accessChat, fetchChats, createGroupChat, renameGroup, addToGroup, removeFromGroup};