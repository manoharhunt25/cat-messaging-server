const asyncHandler = require("express-async-handler");
const generateToken = require("../config/generateToken");
const User = require("../models/userModel");

// Only accept plain strings, so request bodies can't smuggle MongoDB query
// operators (for example {"$ne": null}) into database lookups.
const isText = (v) => typeof v === "string" && v.trim() !== "";

// Escape user input before using it inside a regular expression.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const registerUser = asyncHandler(async (req,res) => {
    const {name,email,password} = req.body;
    if(!isText(name) || !isText(email) || !isText(password)){
        res.status(400);
        throw new Error("Please enter all the fields");
    }

    const userExists = await User.findOne({email});
    if(userExists){
        res.status(400);
        throw new Error("User already exists");
    }

    const user = await User.create({
        name,
        email,
        password,
    });

    if(user){
        res.status(201).json({
            _id: user._id,
            name:user.name,
            email:user.email,
            token:generateToken(user._id),
        });
    }else{
        res.status(400);
        throw new Error("Failed to create user");
    }
});

const authUser = asyncHandler(async(req,res)=> {
    const {email,password} = req.body;

    if(!isText(email) || !isText(password)){
        res.status(400);
        throw new Error("Email and password are required");
    }

    const user = await User.findOne({email});
    if(user && (await user.matchPassword(password))){
        res.json({
            _id: user._id,
            name:user.name,
            email:user.email,
            isAdmin: user.isAdmin,
            token:generateToken(user._id),
        });
    
    }else{
        res.status(401);
        throw new Error("Invalid credentials");
    }
});

// @desc    Search users by name (excludes the caller)
// @route   GET /api/user?search=
// @access  Protected
const allUsers = asyncHandler(async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter = { _id: { $ne: req.user._id } };
  if (search) {
    filter.name = { $regex: escapeRegex(search), $options: "i" };
  }

  // Only return public profile fields: never the password hash
  const users = await User.find(filter).select("name email pic").limit(50);
  res.send(users);
});

module.exports = { registerUser,authUser,allUsers};